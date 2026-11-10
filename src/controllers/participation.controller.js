const mongoose = require('mongoose')
const Activity = require('../models/Activity')
const ActivityParticipation = require('../models/ActivityParticipation')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const volunteerHoursService = require('../services/volunteerHours.service')
const { assertManagesClub } = require('../utils/clubAccess')
const {
  processActivityEvidence,
  readActivityEvidence,
  removeActivityEvidence,
} = require('../utils/activityEvidence')

exports.registerForActivity = catchAsync(async (req, res, next) => {
  const activityId = req.params.id
  if (!isValidObjectId(activityId)) return next(new AppError('Invalid activity id', 400))

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const activity = await Activity.findById(activityId).session(session)
    if (!activity) throw new AppError('Activity not found', 404)
    if (activity.status !== 'upcoming') throw new AppError('Activity is not open for registration', 400)
    if (activity.currentParticipants >= activity.maxParticipants) {
      throw new AppError('Activity is full', 409)
    }

    const existing = await ActivityParticipation.findOne({
      student: req.user.id,
      activity: activityId,
    }).session(session)
    if (existing) throw new AppError('You are already registered for this activity', 409)

    // Registration always starts with hoursEarned = 0 — hours are only ever
    // awarded later, by the admin "mark attended" action.
    const [participation] = await ActivityParticipation.create(
      [
        {
          student: req.user.id,
          activity: activityId,
          status: 'registered',
          hoursEarned: 0,
          registeredAt: new Date(),
        },
      ],
      { session }
    )

    activity.currentParticipants += 1
    await activity.save({ session })

    await session.commitTransaction()
    success(res, 201, { participation }, 'Registered for activity')
  } catch (err) {
    await session.abortTransaction()
    next(err)
  } finally {
    session.endSession()
  }
})

// Cancellation is a hard delete of the participation document, only while
// status is still "registered". It never touches volunteer hours.
exports.cancelRegistration = catchAsync(async (req, res, next) => {
  const activityId = req.params.id
  if (!isValidObjectId(activityId)) return next(new AppError('Invalid activity id', 400))

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const participation = await ActivityParticipation.findOne({
      student: req.user.id,
      activity: activityId,
    }).session(session)

    if (!participation) throw new AppError('Registration not found', 404)
    if (participation.status !== 'registered') {
      throw new AppError('Only active registrations can be cancelled', 400)
    }

    await ActivityParticipation.deleteOne({ _id: participation._id }).session(session)

    await Activity.updateOne(
      { _id: activityId, currentParticipants: { $gt: 0 } },
      { $inc: { currentParticipants: -1 } }
    ).session(session)

    await session.commitTransaction()
    success(res, 200, null, 'Registration cancelled')
  } catch (err) {
    await session.abortTransaction()
    next(err)
  } finally {
    session.endSession()
  }
})

exports.getMyActivities = catchAsync(async (req, res, next) => {
  const participations = await ActivityParticipation.find({ student: req.user.id })
    .populate({ path: 'activity', populate: { path: 'club', select: 'name category' } })
    .sort({ registeredAt: -1 })

  success(res, 200, { participations })
})

// Evidence routes resolve the participation from the authenticated actor;
// no owner ID supplied by the client is used for authorization.
exports.loadOwnEvidenceParticipation = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid participation id', 400))
  const participation = await ActivityParticipation.findOne({ _id: id, student: req.user.id })
  if (!participation) return next(new AppError('Participation not found', 404))
  req.evidenceParticipation = participation
  next()
})

exports.loadManagedEvidenceParticipation = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid participation id', 400))
  const participation = await ActivityParticipation.findById(id).populate('activity', 'club')
  if (!participation) return next(new AppError('Participation not found', 404))
  if (!participation.activity) return next(new AppError('Activity not found', 404))
  await assertManagesClub(req.user, participation.activity.club)
  req.evidenceParticipation = participation
  next()
})

exports.uploadActivityEvidence = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError('Evidence image is required', 400))
  const participation = req.evidenceParticipation
  let evidence
  try {
    evidence = await processActivityEvidence(req.file)
    const previousFilename = participation.evidence?.filename
    participation.evidence = evidence
    await participation.save()
    if (previousFilename) {
      await removeActivityEvidence(previousFilename).catch((error) => {
        console.error('Failed to remove replaced activity evidence:', error.message)
      })
    }
  } catch (error) {
    if (evidence?.filename) await removeActivityEvidence(evidence.filename).catch(() => {})
    throw error
  }

  success(res, 201, { participation }, 'Evidence uploaded')
})

exports.getActivityEvidence = catchAsync(async (req, res, next) => {
  const evidence = req.evidenceParticipation?.evidence
  if (!evidence?.filename) return next(new AppError('Evidence image not found', 404))
  const filePathOrUrl = await readActivityEvidence(evidence)
  if (/^https:\/\//i.test(filePathOrUrl)) {
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    return res.redirect(302, filePathOrUrl)
  }
  res.sendFile(filePathOrUrl, {
    headers: {
      'Content-Type': evidence.contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  }, (error) => {
    if (error && !res.headersSent) next(error)
  })
})

exports.deleteActivityEvidence = catchAsync(async (req, res, next) => {
  const participation = req.evidenceParticipation
  const filename = participation.evidence?.filename
  if (!filename) return next(new AppError('Evidence image not found', 404))
  participation.evidence = undefined
  await participation.save()
  await removeActivityEvidence(filename).catch((error) => {
    console.error('Failed to remove deleted activity evidence:', error.message)
  })
  success(res, 200, { participation }, 'Evidence deleted')
})

exports.getActivityParticipants = catchAsync(async (req, res, next) => {
  const activityId = req.params.id
  if (!isValidObjectId(activityId)) return next(new AppError('Invalid activity id', 400))

  const activity = await Activity.findById(activityId)
  if (!activity) return next(new AppError('Activity not found', 404))

  await assertManagesClub(req.user, activity.club)

  const participants = await ActivityParticipation.find({ activity: activityId })
    .populate('student', 'firstName lastName studentId email')
    .sort({ registeredAt: -1 })

  success(res, 200, { participants })
})

// Authorization is resolved by walking participation -> activity -> club
// before delegating to the volunteer-hours service, which owns the actual
// attend/absent transaction and hour-crediting logic (left unchanged).
exports.markAttended = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid participation id', 400))

  const existing = await ActivityParticipation.findById(id).populate('activity', 'club')
  if (!existing) return next(new AppError('Participation not found', 404))

  await assertManagesClub(req.user, existing.activity?.club)

  const participation = await volunteerHoursService.markAttended(id, req.user.id)
  success(res, 200, { participation }, 'Participant marked as attended')
})

exports.markAbsent = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid participation id', 400))

  const existing = await ActivityParticipation.findById(id).populate('activity', 'club')
  if (!existing) return next(new AppError('Participation not found', 404))

  await assertManagesClub(req.user, existing.activity?.club)

  const participation = await volunteerHoursService.markAbsent(id, req.user.id)
  success(res, 200, { participation }, 'Participant marked as absent')
})

exports.getMyVolunteerHours = catchAsync(async (req, res, next) => {
  const data = await volunteerHoursService.getVolunteerSummary(req.user.id)
  success(res, 200, data)
})

exports.getStudentVolunteerHoursAdmin = catchAsync(async (req, res, next) => {
  const { id } = req.params
  if (!isValidObjectId(id)) return next(new AppError('Invalid student id', 400))

  const student = await User.findById(id)
  if (!student) return next(new AppError('Student not found', 404))

  const data = await volunteerHoursService.getVolunteerSummary(id)
  success(res, 200, data)
})
