const bcrypt = require('bcryptjs')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { signToken } = require('../utils/jwt')
const {
  validateRegisterInput,
  validateLoginInput,
  validateEmailOnlyInput,
} = require('../validators/auth.validator')
const { hashToken } = require('../utils/verificationToken')
const { issueAndSendVerification, logMailFailure } = require('../services/verification.service')
const { MAX_ELEVATED_ADMINS } = require('../utils/adminAccess')
const { NODE_ENV } = require('../config/env')

const SALT_ROUNDS = 12
const COOKIE_NAME = 'token'

const cookieOptions = () => ({
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
})

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user }
  delete obj.passwordHash
  delete obj.emailVerificationTokenHash
  delete obj.emailVerificationExpires
  delete obj.elevatedAdminTokenHash
  delete obj.elevatedAdminExpires
  return obj
}

// Accounts created before email verification existed have no `emailVerified`
// field (undefined). Only an explicit `false` blocks login, so those legacy
// accounts keep working exactly as before.
const isUnverified = (user) => user.emailVerified === false

// Token minting + delivery live in services/verification.service.js so that
// registration, club_admin creation and Super Admin-equivalent elevation all
// share one implementation.

exports.register = catchAsync(async (req, res, next) => {
  validateRegisterInput(req.body)
  const { studentId, firstName, lastName, email, password, phone, faculty, major, year } = req.body

  const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { studentId }] })
  if (existing) {
    return next(new AppError('An account with this email or student ID already exists', 409))
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  const user = await User.create({
    studentId,
    firstName,
    lastName,
    email: email.toLowerCase(),
    passwordHash,
    phone,
    faculty,
    major,
    year,
    role: 'student',
    // Explicitly unverified: this account cannot log in until the emailed
    // link is opened. No session cookie is issued here.
    emailVerified: false,
  })

  // The account is now committed. If the verification email cannot be sent,
  // this is a PARTIAL SUCCESS, not a failure: answering with an error status
  // would tell the user registration failed, they would try again, and the
  // duplicate check would reject them with 409 for an account that does
  // exist. So the response stays 201 and reports delivery separately via
  // `verificationEmailSent`, with a message that says what happened and what
  // to do next. The account is never rolled back, and never duplicated.
  let verificationEmailSent = true
  try {
    await issueAndSendVerification(user)
  } catch (err) {
    verificationEmailSent = false
    logMailFailure('verification send', err)
  }

  success(
    res,
    201,
    { user: sanitizeUser(user), emailVerificationRequired: true, verificationEmailSent },
    verificationEmailSent
      ? 'Registration successful. Please check your email and click the verification link before logging in.'
      : 'Registration successful, but the verification email could not be sent right now. Your account was created — please use "resend verification email" to try again.'
  )
})

exports.verifyEmail = catchAsync(async (req, res, next) => {
  const token = req.body.token || req.query.token
  if (!token || typeof token !== 'string') {
    return next(new AppError('Verification token is required', 400))
  }

  const tokenHash = hashToken(token)

  // One endpoint serves both confirmation kinds. Address verification is
  // checked first; if no account carries that hash, the same token is tried
  // against pending Super Admin-equivalent appointments. Both use identical
  // hash-only storage, expiry and single-use semantics.
  const user = await User.findOne({ emailVerificationTokenHash: tokenHash }).select(
    '+emailVerificationTokenHash +emailVerificationExpires'
  )

  if (user) {
    if (user.emailVerificationExpires && user.emailVerificationExpires.getTime() < Date.now()) {
      return next(
        new AppError('This verification link has expired. Please request a new verification email.', 400)
      )
    }

    user.emailVerified = true
    user.emailVerifiedAt = new Date()
    // Clearing both fields is what makes the token single-use.
    user.emailVerificationTokenHash = null
    user.emailVerificationExpires = null
    await user.save()

    return success(
      res,
      200,
      { user: sanitizeUser(user), kind: 'email' },
      'Email verified successfully. You can now log in.'
    )
  }

  const appointee = await User.findOne({ elevatedAdminTokenHash: tokenHash }).select(
    '+elevatedAdminTokenHash +elevatedAdminExpires'
  )

  // No match on either hash: never valid, already consumed (fields are
  // cleared on success), or superseded by a newer token.
  if (!appointee) {
    return next(
      new AppError('This verification link is invalid or has already been used. Please request a new one.', 400)
    )
  }

  if (appointee.elevatedAdminExpires && appointee.elevatedAdminExpires.getTime() < Date.now()) {
    // Expired appointments are cleared so the slot is not held open.
    appointee.elevatedAdminPending = undefined
    appointee.elevatedAdminTokenHash = null
    appointee.elevatedAdminExpires = null
    await appointee.save()
    return next(
      new AppError('This appointment link has expired. Please ask a Super Admin to grant it again.', 400)
    )
  }

  // The cap is re-checked at activation time, not just at grant time: two
  // appointments issued while a slot was free must not both activate into a
  // third elevated administrator.
  const activeCount = await User.countDocuments({ elevatedAdmin: true, _id: { $ne: appointee._id } })
  if (activeCount >= MAX_ELEVATED_ADMINS) {
    return next(
      new AppError(
        `This appointment cannot be activated: the maximum of ${MAX_ELEVATED_ADMINS} Super Admin-equivalent administrators has already been reached. Ask a Super Admin to revoke one first.`,
        409
      )
    )
  }

  appointee.elevatedAdmin = true
  appointee.elevatedAdminGrantedAt = new Date()
  appointee.elevatedAdminPending = undefined
  // Clearing the token is what makes the appointment link single-use.
  appointee.elevatedAdminTokenHash = null
  appointee.elevatedAdminExpires = null
  await appointee.save()

  success(
    res,
    200,
    { user: sanitizeUser(appointee), kind: 'elevation' },
    'Administrator appointment confirmed. Your Super Admin-equivalent permissions are now active.'
  )
})

exports.resendVerification = catchAsync(async (req, res, next) => {
  validateEmailOnlyInput(req.body)
  const email = req.body.email.toLowerCase()

  const user = await User.findOne({ email })

  // Always answer the same way so this endpoint cannot be used to probe
  // which email addresses have accounts.
  const genericMessage =
    'If that email address needs verification, a new verification link has been sent to it.'

  if (!user || !isUnverified(user)) {
    return success(res, 200, null, genericMessage)
  }

  try {
    await issueAndSendVerification(user)
  } catch (err) {
    logMailFailure('resend', err)
    // Reported as a mail-service problem, never as a statement about the
    // account: the message is identical no matter which address was asked
    // for, and carries no SMTP detail.
    return next(
      new AppError('Could not send the verification email right now. Please try again later.', 503)
    )
  }

  success(res, 200, null, genericMessage)
})

exports.login = catchAsync(async (req, res, next) => {
  validateLoginInput(req.body)
  const { email, password } = req.body

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')
  if (!user) return next(new AppError('Invalid email or password', 401))

  const isMatch = await bcrypt.compare(password, user.passwordHash)
  if (!isMatch) return next(new AppError('Invalid email or password', 401))

  // Credentials are correct but the address was never confirmed — no session
  // is issued. 403 (not 401) so the frontend can tell this apart from a bad
  // password and offer to resend the link.
  if (isUnverified(user)) {
    return next(
      new AppError(
        'Please verify your email before logging in. Check your inbox for the verification link.',
        403
      )
    )
  }

  const token = signToken({ sub: user._id.toString(), role: user.role })
  res.cookie(COOKIE_NAME, token, cookieOptions())

  success(res, 200, { user: sanitizeUser(user) }, 'Login successful')
})

exports.logout = catchAsync(async (req, res, next) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  })
  success(res, 200, null, 'Logged out successfully')
})

exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id)
  if (!user) return next(new AppError('User not found', 404))
  success(res, 200, { user: sanitizeUser(user) })
})

exports.updateMe = catchAsync(async (req, res, next) => {
  const allowedFields = ['firstName', 'lastName', 'phone', 'faculty', 'major', 'year', 'profileImage']
  const updates = {}
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  })

  const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true })
  if (!user) return next(new AppError('User not found', 404))

  success(res, 200, { user: sanitizeUser(user) }, 'Profile updated')
})
