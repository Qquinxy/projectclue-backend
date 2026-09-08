const Activity = require('../models/Activity')
const ActivityParticipation = require('../models/ActivityParticipation')
const Club = require('../models/Club')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const { validateActivityInput } = require('../validators/activity.validator')
const { assertManagesClub } = require('../utils/clubAccess')
const {
  toPublicPath,
  removeActivityImageFile,
  sanitizeImageList,
} = require('../utils/activityImages')

exports.listActivities = catchAsync(async (req, res, next) => {
  const { search, type, status, club } = req.query
  const filter = {}
  if (type) filter.type = type
  if (status) filter.status = status
  if (club && isValidObjectId(club)) filter.club = club
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ]
  }

  const limit = req.query.limit ? Number(req.query.limit) : 0
  let query = Activity.find(filter).populate('club', 'name category').sort({ date: 1 })
  if (limit > 0) query = query.limit(limit)

  const activities = await query
  success(res, 200, { activities })
})

exports.getActivity = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid activity id', 400))

  const activity = await Activity.findById(id).populate('club', 'name category location')
  if (!activity) return next(new AppError('Activity not found', 404))

  success(res, 200, { activity })
})

exports.createActivity = catchAsync(async (req, res, next) => {
  validateActivityInput(req.body)

  const club = await Club.findById(req.body.club)
  if (!club) return next(new AppError('Club not found', 404))

  // A club_admin may only create activities under a club they manage; a
  // superadmin may create under any club. The target club id (not an
  // arbitrary trusted value) is what gets checked.
  await assertManagesClub(req.user, club._id)

  // `images` is the field of record. A legacy `image` string in the request
  // (older API consumers, or a pasted URL) is folded into the same list, so
  // create-with-an-image keeps working and never produces a document whose
  // two image fields disagree.
  const images = sanitizeImageList(req.body.images, req.body.image)

  const activity = await Activity.create({
    ...req.body,
    images,
    image: images[0] || '',
    currentParticipants: 0,
    createdBy: req.user.id,
  })

  success(res, 201, { activity }, 'Activity created')
})

exports.updateActivity = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid activity id', 400))
  validateActivityInput(req.body, { partial: true })

  const activity = await Activity.findById(id)
  if (!activity) return next(new AppError('Activity not found', 404))

  // Authorization is based on the activity's existing club.
  await assertManagesClub(req.user, activity.club)

  // If the request also tries to move the activity to a different club,
  // the admin must manage that destination club too — otherwise a
  // club_admin could transfer an activity out from under another club_admin.
  if (req.body.club && req.body.club !== activity.club.toString()) {
    await assertManagesClub(req.user, req.body.club)
  }

  delete req.body.currentParticipants
  delete req.body.createdBy

  // The gallery is owned by the dedicated image endpoints below. Stripping
  // both fields here means a PATCH that happens to echo back the activity
  // (or omits them entirely) can never wipe the images of an existing
  // activity — including an old one whose picture still lives in `image`.
  delete req.body.images
  delete req.body.image

  Object.assign(activity, req.body)
  await activity.save()

  success(res, 200, { activity }, 'Activity updated')
})

exports.deleteActivity = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid activity id', 400))

  const activity = await Activity.findById(id)
  if (!activity) return next(new AppError('Activity not found', 404))

  // Authorization is resolved BEFORE the participation guard, so an admin
  // acting outside their clubs still gets 403 rather than learning whether
  // the activity has participants.
  await assertManagesClub(req.user, activity.club)

  // Attendance records are academic data: hoursEarned on a participation
  // feeds users.totalVolunteerHours, which students are graded against.
  // Hard-deleting the activity would leave those participations pointing at
  // nothing — the rows survive, but their activity can no longer be resolved,
  // which is exactly how the existing dangling records were produced.
  //
  // So once anyone has registered, the activity may only be retired by
  // setting status to "cancelled" (already part of ACTIVITY_STATUSES and
  // already handled everywhere in the UI). Deleting an activity nobody
  // signed up for stays allowed, since that destroys nothing.
  const participationCount = await ActivityParticipation.countDocuments({ activity: id })
  if (participationCount > 0) {
    return next(
      new AppError(
        `This activity cannot be deleted because it has ${participationCount} participant record(s). ` +
          'Set the activity status to "cancelled" instead — that keeps attendance history and volunteer hours intact.',
        409
      )
    )
  }

  const images = Activity.resolveImages(activity)

  await Activity.deleteOne({ _id: id })

  // Nothing references these files any more, so drop them from disk too.
  // Best-effort: a failed unlink leaves an orphan but must not turn a
  // successful delete into an error.
  await Promise.all(images.map((image) => removeActivityImageFile(image)))

  success(res, 200, null, 'Activity deleted')
})

// POST /api/activities/:id/images  (multipart/form-data, field: "images")
//
// Appends one or more images to the activity's gallery. Called repeatedly to
// keep adding images later — existing images are never replaced.
exports.uploadActivityImages = catchAsync(async (req, res, next) => {
  const { id } = req.params
  const files = req.files || []

  // Any file multer already wrote for a request that turns out to be invalid
  // or unauthorized is removed again, so a rejected upload leaves nothing
  // behind on disk.
  const discardUploads = () =>
    Promise.all(files.map((file) => removeActivityImageFile(toPublicPath(file.filename))))

  const reject = async (error) => {
    await discardUploads()
    return next(error)
  }

  if (!isValidObjectId(id)) return reject(new AppError('Invalid activity id', 400))
  if (files.length === 0) return reject(new AppError('At least one image file is required', 400))

  const activity = await Activity.findById(id)
  if (!activity) return reject(new AppError('Activity not found', 404))

  // Same ownership rule as updateActivity: superadmin any activity, club_admin
  // only activities under a club they manage. Students never reach this — the
  // route is role-gated — but the club check is what stops one club_admin from
  // uploading into another club's activity.
  try {
    await assertManagesClub(req.user, activity.club)
  } catch (err) {
    return reject(err)
  }

  // Fold a legacy single `image` into `images` on first write, so the old
  // picture becomes the cover of the new gallery instead of being lost.
  const images = Activity.resolveImages(activity)
  images.push(...files.map((file) => toPublicPath(file.filename)))

  activity.images = images
  activity.image = images[0] || ''
  await activity.save()

  success(res, 201, { activity }, 'Activity images uploaded')
})

// DELETE /api/activities/:id/images   body (or query): { image: "<stored path>" }
//
// Removes exactly one image from the gallery, leaving the others in order.
exports.deleteActivityImage = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid activity id', 400))

  const target = typeof req.body?.image === 'string' ? req.body.image : req.query.image
  if (typeof target !== 'string' || target.trim() === '') {
    return next(new AppError('An image path is required', 400))
  }
  const image = target.trim()

  const activity = await Activity.findById(id)
  if (!activity) return next(new AppError('Activity not found', 404))

  await assertManagesClub(req.user, activity.club)

  const images = Activity.resolveImages(activity)
  const index = images.indexOf(image)
  if (index === -1) return next(new AppError('Image not found on this activity', 404))

  images.splice(index, 1)

  activity.images = images
  // Keep the legacy field pointing at the new cover (empty once the gallery
  // is), so an old consumer reading `image` never shows a deleted picture.
  activity.image = images[0] || ''
  await activity.save()

  await removeActivityImageFile(image)

  success(res, 200, { activity }, 'Activity image deleted')
})
