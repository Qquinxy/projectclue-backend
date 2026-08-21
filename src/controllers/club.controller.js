const Club = require('../models/Club')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const { validateClubInput } = require('../validators/club.validator')
const { assertManagesClub } = require('../utils/clubAccess')

exports.listClubs = catchAsync(async (req, res, next) => {
  const { search, category } = req.query
  const filter = {}
  if (category) filter.category = category
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ]
  }

  const limit = req.query.limit ? Number(req.query.limit) : 0
  let query = Club.find(filter).sort({ createdAt: -1 })
  if (limit > 0) query = query.limit(limit)

  const clubs = await query
  success(res, 200, { clubs })
})

exports.getClub = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))

  const club = await Club.findById(id)
  if (!club) return next(new AppError('Club not found', 404))

  success(res, 200, { club })
})

exports.createClub = catchAsync(async (req, res, next) => {
  validateClubInput(req.body)

  const club = await Club.create({
    ...req.body,
    memberCount: 0,
    createdBy: req.user.id,
  })

  success(res, 201, { club }, 'Club created')
})

exports.updateClub = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))
  validateClubInput(req.body, { partial: true })

  const club = await Club.findById(id)
  if (!club) return next(new AppError('Club not found', 404))

  // A club_admin may only edit a club they manage; a superadmin may edit any.
  await assertManagesClub(req.user, club._id)

  delete req.body.memberCount
  delete req.body.createdBy

  Object.assign(club, req.body)
  await club.save()

  success(res, 200, { club }, 'Club updated')
})

exports.deleteClub = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))

  const club = await Club.findByIdAndDelete(id)
  if (!club) return next(new AppError('Club not found', 404))

  success(res, 200, null, 'Club deleted')
})
