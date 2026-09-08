const Club = require('../models/Club')
const Activity = require('../models/Activity')
const ClubMembership = require('../models/ClubMembership')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const { validateClubInput } = require('../validators/club.validator')
const { assertManagesClub } = require('../utils/clubAccess')
const {
  toPublicPath,
  removeClubGalleryFile,
  resolveGalleryImages,
} = require('../utils/clubGalleryImages')

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

  // The gallery is owned by the gallery endpoints only — a JSON body never
  // sets it. `image` (the cover) is untouched and still accepted as before.
  delete req.body.galleryImages

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

  // Same reasoning as create: the gallery is managed only through
  // POST/DELETE /clubs/:id/gallery-images, so a PATCH that omits or echoes
  // back `galleryImages` can never erase a club's photos. The cover `image`
  // keeps its existing behaviour and is deliberately NOT stripped.
  delete req.body.galleryImages

  Object.assign(club, req.body)
  await club.save()

  success(res, 200, { club }, 'Club updated')
})

exports.uploadClubImage = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))
  if (!req.file) return next(new AppError('An image file is required', 400))

  const club = await Club.findById(id)
  if (!club) return next(new AppError('Club not found', 404))

  // A club_admin may only upload for a club they manage; superadmin may for any.
  await assertManagesClub(req.user, club._id)

  club.image = `/uploads/clubs/${req.file.filename}`
  await club.save()

  success(res, 200, { club }, 'Club image uploaded')
})

// POST /api/clubs/:id/gallery-images  (multipart/form-data, field: "images")
//
// Appends photos to the club's own gallery. Called repeatedly to keep adding
// photos later — existing gallery photos are never replaced, and the club's
// cover image (`club.image`) is never read or written here.
exports.uploadClubGalleryImages = catchAsync(async (req, res, next) => {
  const { id } = req.params
  const files = req.files || []

  // Any file multer already wrote for a request that turns out to be invalid
  // or unauthorized is removed again, so a rejected upload leaves nothing
  // behind on disk.
  const discardUploads = () =>
    Promise.all(files.map((file) => removeClubGalleryFile(toPublicPath(file.filename))))

  const reject = async (error) => {
    await discardUploads()
    return next(error)
  }

  if (!isValidObjectId(id)) return reject(new AppError('Invalid club id', 400))
  if (files.length === 0) return reject(new AppError('At least one image file is required', 400))

  const club = await Club.findById(id)
  if (!club) return reject(new AppError('Club not found', 404))

  // Same ownership rule as updateClub: superadmin any club, club_admin only a
  // club they manage. Students never reach this — the route is role-gated —
  // but this check is what stops one club_admin from uploading into another
  // club_admin's club.
  try {
    await assertManagesClub(req.user, club._id)
  } catch (err) {
    return reject(err)
  }

  club.galleryImages = [
    ...resolveGalleryImages(club),
    ...files.map((file) => toPublicPath(file.filename)),
  ]
  await club.save()

  success(res, 200, { club }, 'Club gallery images uploaded')
})

// DELETE /api/clubs/:id/gallery-images
//   body (or query): { image: "/uploads/clubs-gallery/<file>" }
//
// Removes exactly one photo from the gallery, leaving the others in order.
// The club's cover image is never a valid target here: it is not in
// `galleryImages`, so it can only ever produce a 404.
exports.deleteClubGalleryImage = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))

  const target = typeof req.body?.image === 'string' ? req.body.image : req.query.image
  if (typeof target !== 'string' || target.trim() === '') {
    return next(new AppError('An image path is required', 400))
  }
  const image = target.trim()

  const club = await Club.findById(id)
  if (!club) return next(new AppError('Club not found', 404))

  await assertManagesClub(req.user, club._id)

  // Only a path this club's gallery actually holds can be deleted — an
  // arbitrary filesystem path, another club's photo, an activity image or the
  // cover image all fall through to 404. removeClubGalleryFile additionally
  // refuses anything resolving outside uploads/clubs-gallery.
  const gallery = resolveGalleryImages(club)
  const index = gallery.indexOf(image)
  if (index === -1) return next(new AppError('Image not found in this club\'s gallery', 404))

  gallery.splice(index, 1)
  club.galleryImages = gallery
  await club.save()

  await removeClubGalleryFile(image)

  success(res, 200, { club }, 'Club gallery image deleted')
})

exports.deleteClub = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid club id', 400))

  // Fetched (not findByIdAndDelete) so the related-records guard below can run
  // before anything is removed. The route is already superadmin-only.
  const club = await Club.findById(id)
  if (!club) return next(new AppError('Club not found', 404))

  // Same reasoning as deleteActivity: deleting a club would orphan its
  // activities and memberships — and, transitively, the attendance records
  // hanging off those activities. Nothing is cascade-deleted here; the club
  // simply cannot be removed while dependent records exist.
  const [activityCount, membershipCount] = await Promise.all([
    Activity.countDocuments({ club: id }),
    ClubMembership.countDocuments({ club: id }),
  ])

  if (activityCount > 0 || membershipCount > 0) {
    const parts = []
    if (activityCount > 0) parts.push(`${activityCount} activity/activities`)
    if (membershipCount > 0) parts.push(`${membershipCount} member(s)`)
    return next(
      new AppError(
        `This club cannot be deleted because it still has ${parts.join(' and ')}. ` +
          'Remove or cancel those records first — deleting the club would orphan attendance history and volunteer hours.',
        409
      )
    )
  }

  const gallery = resolveGalleryImages(club)

  await Club.deleteOne({ _id: id })

  // Nothing references these gallery photos any more, so drop them from disk
  // too. Best-effort: a failed unlink leaves an orphan but must not turn a
  // successful delete into an error. The cover image file is left alone, as
  // it was before this feature.
  await Promise.all(gallery.map((image) => removeClubGalleryFile(image)))

  success(res, 200, null, 'Club deleted')
})
