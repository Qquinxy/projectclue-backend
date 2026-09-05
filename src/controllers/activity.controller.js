const Activity = require('../models/Activity')
const ActivityParticipation = require('../models/ActivityParticipation')
const Club = require('../models/Club')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const { validateActivityInput } = require('../validators/activity.validator')
const { assertManagesClub } = require('../utils/clubAccess')

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

  const activity = await Activity.create({
    ...req.body,
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

  await Activity.deleteOne({ _id: id })

  success(res, 200, null, 'Activity deleted')
})
