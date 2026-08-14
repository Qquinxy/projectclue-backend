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

const SALT_ROUNDS = 12

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user }
  delete obj.passwordHash
  return obj
}

const ensureClubsExist = async (clubIds) => {
  if (!clubIds || clubIds.length === 0) return
  const count = await Club.countDocuments({ _id: { $in: clubIds } })
  if (count !== new Set(clubIds.map(String)).size) {
    throw new AppError('One or more clubs in managedClubs do not exist', 400)
  }
}

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
  })

  success(res, 201, { user: sanitizeUser(user) }, 'Club admin created')
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

exports.deleteClubAdmin = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid user id', 400))

  const target = await User.findById(id)
  if (!target || target.role !== 'club_admin') {
    return next(new AppError('Club admin not found', 404))
  }

  await User.deleteOne({ _id: id })
  success(res, 200, null, 'Club admin deleted')
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
