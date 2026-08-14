const mongoose = require('mongoose')
const ActivityParticipation = require('../models/ActivityParticipation')
const User = require('../models/User')
const AppError = require('../utils/AppError')

// Marks a participant as attended and credits volunteer hours in a single
// transaction. hoursEarned is taken from activity.volunteerHours at the
// moment of marking — it is never supplied by the client. Rejects if the
// participation is already attended to prevent double-crediting.
exports.markAttended = async (participationId, adminId) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const participation = await ActivityParticipation.findById(participationId)
      .populate('activity')
      .session(session)

    if (!participation) throw new AppError('Participation not found', 404)
    if (participation.status === 'attended') {
      throw new AppError('Participation is already marked as attended', 409)
    }

    const hours = participation.activity?.volunteerHours || 0

    participation.status = 'attended'
    participation.attendedAt = new Date()
    participation.hoursEarned = hours
    participation.markedBy = adminId
    await participation.save({ session })

    if (hours > 0) {
      await User.updateOne(
        { _id: participation.student },
        { $inc: { totalVolunteerHours: hours } }
      ).session(session)
    }

    await session.commitTransaction()
    return participation
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}

// Marks a participant as absent. hoursEarned is reset to 0. If the
// participation had previously been marked attended (an admin correcting a
// mistake), the previously credited hours are reversed so
// users.totalVolunteerHours never drifts out of sync with the source data.
exports.markAbsent = async (participationId, adminId) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const participation = await ActivityParticipation.findById(participationId).session(session)
    if (!participation) throw new AppError('Participation not found', 404)

    const previousHours = participation.status === 'attended' ? participation.hoursEarned : 0

    participation.status = 'absent'
    participation.attendedAt = null
    participation.hoursEarned = 0
    participation.markedBy = adminId
    await participation.save({ session })

    if (previousHours > 0) {
      await User.updateOne(
        { _id: participation.student },
        { $inc: { totalVolunteerHours: -previousHours } }
      ).session(session)
    }

    await session.commitTransaction()
    return participation
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}

// Volunteer history is always derived from activityparticipations where
// status = attended — never from a separate cached history collection.
exports.getVolunteerSummary = async (studentId) => {
  const user = await User.findById(studentId).select('totalVolunteerHours firstName lastName studentId')
  if (!user) throw new AppError('Student not found', 404)

  const history = await ActivityParticipation.find({ student: studentId, status: 'attended' })
    .populate({ path: 'activity', populate: { path: 'club', select: 'name' } })
    .sort({ attendedAt: -1 })

  return {
    totalVolunteerHours: user.totalVolunteerHours,
    activitiesCompleted: history.length,
    history,
  }
}
