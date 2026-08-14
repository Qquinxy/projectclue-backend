const mongoose = require('mongoose')

const PARTICIPATION_STATUSES = ['registered', 'attended', 'absent', 'cancelled']

const activityParticipationSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true },
  status: { type: String, enum: PARTICIPATION_STATUSES, default: 'registered' },
  registeredAt: { type: Date, default: Date.now },
  attendedAt: { type: Date, default: null },
  hoursEarned: { type: Number, default: 0 },
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
})

activityParticipationSchema.index({ student: 1, activity: 1 }, { unique: true })

const ActivityParticipation = mongoose.model('ActivityParticipation', activityParticipationSchema)
ActivityParticipation.STATUSES = PARTICIPATION_STATUSES

module.exports = ActivityParticipation
