const bcrypt = require('bcryptjs')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { signToken } = require('../utils/jwt')
const { validateRegisterInput, validateLoginInput } = require('../validators/auth.validator')
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
  return obj
}

// Email verification has been removed from the system. Accounts are usable
// the moment they are created:
//   - registration and club_admin creation write `emailVerified: true`
//   - login has no verification gate
//   - no mail is sent by any auth path
//
// `emailVerified` / `emailVerifiedAt` are still written because the Google
// OAuth flow (googleAuth.controller.js) sets them, and existing documents
// carry them. Nothing reads them as a gate any more.

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
    emailVerified: true,
    emailVerifiedAt: new Date(),
  })

  // No session cookie is issued here: registration and login stay separate
  // steps, exactly as before. The difference is that the account can be used
  // immediately instead of waiting on an emailed link.
  success(
    res,
    201,
    { user: sanitizeUser(user) },
    'Registration successful. You can now log in.'
  )
})

exports.login = catchAsync(async (req, res, next) => {
  validateLoginInput(req.body)
  const { email, password } = req.body

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')
  if (!user) return next(new AppError('Invalid email or password', 401))

  const isMatch = await bcrypt.compare(password, user.passwordHash)
  if (!isMatch) return next(new AppError('Invalid email or password', 401))

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

  const currentUser = await User.findById(req.user.id)
  if (!currentUser) return next(new AppError('User not found', 404))

  if (req.body.studentId !== undefined && req.body.studentId !== currentUser.studentId) {
    const studentId = typeof req.body.studentId === 'string' ? req.body.studentId.trim() : ''
    if (!/^\d{11}-\d$/.test(studentId)) {
      return next(new AppError('studentId must match the format 67543206105-8', 400))
    }
    const duplicate = await User.findOne({ studentId })
    if (duplicate && String(duplicate._id) !== String(currentUser._id)) {
      return next(new AppError('studentId is already in use', 409))
    }
    updates.studentId = studentId
  }

  const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true })
  if (!user) return next(new AppError('User not found', 404))

  success(res, 200, { user: sanitizeUser(user) }, 'Profile updated')
})
