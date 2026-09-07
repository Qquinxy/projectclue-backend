const ReferenceData = require('../models/ReferenceData')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')

const TYPES = ['faculty', 'year', 'major']

const sanitize = (item) => ({
  id: item._id.toString(),
  type: item.type,
  value: item.value,
  label: item.label || item.value,
  sortOrder: item.sortOrder ?? 0,
})

const normalizeBody = (body) => {
  const { type, value, label, sortOrder } = body || {}
  const norm = {}
  if (type !== undefined) norm.type = type
  if (value !== undefined) norm.value = String(value).trim()
  if (label !== undefined) norm.label = String(label).trim()
  if (sortOrder !== undefined) norm.sortOrder = Number(sortOrder)
  return norm
}

const assertValid = (body, { requireAll } = {}) => {
  const { type, value, sortOrder } = body
  if (type !== undefined && !TYPES.includes(type)) {
    throw new AppError(`type must be one of: ${TYPES.join(', ')}`, 400)
  }
  if (requireAll) {
    if (!value) throw new AppError('value is required', 400)
  }
  if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
    throw new AppError('sortOrder must be a number', 400)
  }
}

// Public: the selectable lists used by the register form and the profile
// editor. Optional ?type=faculty|year|major filters; unset returns all.
exports.listReference = catchAsync(async (req, res, next) => {
  const { type } = req.query
  const filter = type ? { type } : {}

  const items = await ReferenceData.find(filter).sort({ type: 1, sortOrder: 1, value: 1 })
  success(res, 200, { referenceData: items.map(sanitize), types: TYPES })
})

// --- Admin CRUD (superadmin only) -----------------------------------------

exports.adminList = catchAsync(async (req, res, next) => {
  const items = await ReferenceData.find({}).sort({ type: 1, sortOrder: 1, value: 1 })
  success(res, 200, { referenceData: items.map(sanitize) })
})

exports.createReference = catchAsync(async (req, res, next) => {
  const body = normalizeBody(req.body)
  assertValid(body, { requireAll: true })

  try {
    const item = await ReferenceData.create(body)
    success(res, 201, { referenceData: sanitize(item) }, 'Created successfully')
  } catch (err) {
    if (err.code === 11000) {
      return next(new AppError('This value already exists for the selected type', 409))
    }
    next(err)
  }
})

exports.updateReference = catchAsync(async (req, res, next) => {
  const item = await ReferenceData.findById(req.params.id)
  if (!item) return next(new AppError('Reference value not found', 404))

  const body = normalizeBody(req.body)
  assertValid(body)
  if (Object.keys(body).length === 0) return next(new AppError('Nothing to update', 400))
  if (body.value && String(body.value).trim() === '') return next(new AppError('value must not be empty', 400))

  try {
    Object.assign(item, body)
    await item.save()
    success(res, 200, { referenceData: sanitize(item) }, 'Updated successfully')
  } catch (err) {
    if (err.code === 11000) {
      return next(new AppError('This value already exists for the selected type', 409))
    }
    next(err)
  }
})

exports.deleteReference = catchAsync(async (req, res, next) => {
  const item = await ReferenceData.findByIdAndDelete(req.params.id)
  if (!item) return next(new AppError('Reference value not found', 404))

  // Users keep whatever value their profile already stored — deleting a
  // reference entry only removes it from future selects, never wipes data.
  success(res, 200, null, 'Deleted successfully')
})