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
  // Optional evidence metadata. Existing participation records remain valid;
  // evidence never changes Attendance or volunteer-hour fields.
  evidence: {
    filename: { type: String },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    uploadedAt: { type: Date },
  },
})

activityParticipationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    if (ret.evidence) {
      delete ret.evidence.filename
      if (Object.values(ret.evidence).every((value) => value == null)) delete ret.evidence
    }
    return ret
  },
})

activityParticipationSchema.index({ student: 1, activity: 1 }, { unique: true })

const ActivityParticipation = mongoose.model('ActivityParticipation', activityParticipationSchema)
ActivityParticipation.STATUSES = PARTICIPATION_STATUSES

module.exports = ActivityParticipation
