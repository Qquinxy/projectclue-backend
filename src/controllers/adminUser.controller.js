const bcrypt = require('bcryptjs')
const User = require('../models/User')
const Club = require('../models/Club')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const {
  validateCreateClubAdminInput,
  validateUpdateClubAdminInput,
  validateAssignClubsInput,
} = require('../validators/adminUser.validator')
const {
  issueAndSendVerification,
  issueAndSendElevation,
  logMailFailure,
} = require('../services/verification.service')
const { MAX_ELEVATED_ADMINS, isRootSuperadmin } = require('../utils/adminAccess')

const SALT_ROUNDS = 12

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user }
  delete obj.passwordHash
  delete obj.emailVerificationTokenHash
  delete obj.emailVerificationExpires
  delete obj.elevatedAdminTokenHash
  delete obj.elevatedAdminExpires
  return obj
}

const ensureClubsExist = async (clubIds) => {
  if (!clubIds || clubIds.length === 0) return
  const count = await Club.countDocuments({ _id: { $in: clubIds } })
  if (count !== new Set(clubIds.map(String)).size) {
    throw new AppError('One or more clubs in managedClubs do not exist', 400)
  }
}

exports.listClubAdmins = catchAsync(async (req, res, next) => {
  const users = await User.find({ role: 'club_admin' }).sort({ createdAt: -1 })
  success(res, 200, { users: users.map(sanitizeUser) })
})

// This route family exists specifically to create/manage club_admin
// accounts. There is intentionally no way through here (or anywhere else)
// for a client to create a superadmin — that only happens via the
// seed:admin CLI script.
exports.createClubAdmin = catchAsync(async (req, res, next) => {
  validateCreateClubAdminInput(req.body)
  const { studentId, firstName, lastName, email, password, phone, managedClubs = [] } = req.body

  const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { studentId }] })
  if (existing) {
    return next(new AppError('An account with this email or student ID already exists', 409))
  }

  await ensureClubsExist(managedClubs)

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  const user = await User.create({
    studentId,
    firstName,
    lastName,
    email: email.toLowerCase(),
    passwordHash,
    phone,
    role: 'club_admin',
    managedClubs,
    faculty: '-',
    major: '-',
    year: 0,
    // Club admins go through exactly the same email verification as student
    // registration — this account cannot log in until the emailed link is
    // opened. No bypass.
    emailVerified: false,
  })

  // Same partial-success contract as registration: the account is committed,
  // and a delivery failure is reported separately rather than being turned
  // into an error that would suggest the account was not created.
  let verificationEmailSent = true
  try {
    await issueAndSendVerification(user)
  } catch (err) {
    verificationEmailSent = false
    logMailFailure('club admin verification send', err)
  }

  success(
    res,
    201,
    { user: sanitizeUser(user), verificationEmailSent },
    verificationEmailSent
      ? 'Club admin created. A verification email has been sent — the account can log in once the link is opened.'
      : 'Club admin created, but the verification email could not be sent right now. Use "resend verification email" with their address to try again.'
  )
})

exports.updateClubAdmin = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))
  validateUpdateClubAdminInput(req.body)

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  const allowedFields = ['firstName', 'lastName', 'phone', 'email']
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      target[field] = field === 'email' ? req.body[field].toLowerCase() : req.body[field]
    }
  })

  await target.save()
  success(res, 200, { user: sanitizeUser(target) }, 'Club admin updated')
})

// Removing a club admin REVOKES THE POSITION — it never deletes the account.
//
// The User document stays in `users` with its credentials, verified email,
// studentId and accumulated totalVolunteerHours intact, and is simply
// returned to the ordinary `student` role. Their ClubMembership and
// ActivityParticipation history is deliberately left untouched: deleting the
// account would orphan those documents (their `student` reference would point
// at nothing), which is exactly what the previous hard delete did.
//
// Everything that granted elevated access is cleared in the same save, so the
// Super Admin-equivalent slot is freed immediately and any invitation that
// was still outstanding can no longer be redeemed.
exports.removeClubAdmin = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  target.role = 'student'
  target.managedClubs = []
  // Revoke an active elevation and invalidate any pending invitation:
  // clearing the token hash is what makes an outstanding link unredeemable,
  // exactly as revokeClubAdminElevation does.
  target.elevatedAdmin = undefined
  target.elevatedAdminGrantedAt = null
  target.elevatedAdminPending = undefined
  target.elevatedAdminTokenHash = null
  target.elevatedAdminExpires = null
  await target.save()

  success(
    res,
    200,
    { user: sanitizeUser(target) },
    'Club admin position removed. The account remains active as a student.'
  )
})

// --- Super Admin-equivalent elevation ------------------------------------
//
// POST   /api/admin/users/:id/elevate  — grant (pending until email confirmed)
// DELETE /api/admin/users/:id/elevate  — revoke, freeing a slot
//
// Only a real superadmin may grant or revoke: an elevated club_admin
// deliberately cannot promote others or demote the account that appointed it,
// even though it otherwise passes authorize('superadmin').
const assertRootSuperadmin = (user) => {
  if (!isRootSuperadmin(user)) {
    throw new AppError('Only a Super Admin can grant or revoke administrator privileges', 403)
  }
}

// Counts BOTH active holders and outstanding pending appointments, so two
// grants issued back-to-back cannot both activate past the cap. The cap is
// re-checked again at activation time in auth.controller.verifyEmail.
const countElevatedOrPending = (excludeUserId) =>
  User.countDocuments({
    $or: [{ elevatedAdmin: true }, { elevatedAdminPending: true }],
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
  })

exports.elevateClubAdmin = catchAsync(async (req, res, next) => {
  assertRootSuperadmin(req.user)

  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  if (target.elevatedAdmin === true) {
    return next(new AppError('This club admin already holds Super Admin-equivalent privileges', 409))
  }

  // The appointee must own a confirmed address first — the appointment is
  // itself confirmed by email, so an unverified address could never receive it.
  if (target.emailVerified === false) {
    return next(
      new AppError(
        'This club admin has not verified their email address yet. They must verify it before being appointed.',
        400
      )
    )
  }

  const taken = await countElevatedOrPending(target._id)
  if (taken >= MAX_ELEVATED_ADMINS) {
    return next(
      new AppError(
        `A maximum of ${MAX_ELEVATED_ADMINS} Super Admin-equivalent administrators is allowed. Revoke an existing one before appointing another.`,
        409
      )
    )
  }

  try {
    await issueAndSendElevation(target)
  } catch (err) {
    logMailFailure('elevation send', err)
    // The appointment is left pending and can simply be granted again once
    // mail delivery recovers; no privilege was granted.
    return next(
      new AppError('Could not send the appointment confirmation email right now. Please try again later.', 503)
    )
  }

  success(
    res,
    200,
    { user: sanitizeUser(target), elevationPending: true },
    'Appointment email sent. The privilege becomes active only after the club admin confirms it by email.'
  )
})

exports.revokeClubAdminElevation = catchAsync(async (req, res, next) => {
  assertRootSuperadmin(req.user)

  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  if (target.elevatedAdmin !== true && target.elevatedAdminPending !== true) {
    return next(new AppError('This club admin does not hold Super Admin-equivalent privileges', 400))
  }

  // Revoking clears the active grant AND any outstanding invitation, so the
  // slot is genuinely free for someone else. The club_admin role, managed
  // clubs and login all continue to work untouched.
  target.elevatedAdmin = undefined
  target.elevatedAdminGrantedAt = null
  target.elevatedAdminPending = undefined
  target.elevatedAdminTokenHash = null
  target.elevatedAdminExpires = null
  await target.save()

  success(res, 200, { user: sanitizeUser(target) }, 'Super Admin-equivalent privileges revoked')
})

exports.assignClubs = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))
  validateAssignClubsInput(req.body)

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  await ensureClubsExist(req.body.managedClubs)

  target.managedClubs = req.body.managedClubs
  await target.save()

  success(res, 200, { user: sanitizeUser(target) }, 'Managed clubs updated')
})
