const mongoose = require('mongoose')

const ACTIVITY_TYPES = ['volunteer', 'workshop', 'meeting', 'event', 'training']
const ACTIVITY_STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled']

const activitySchema = new mongoose.Schema(
  {
    club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    location: { type: String, default: '' },
    maxParticipants: { type: Number, required: true },
    currentParticipants: { type: Number, default: 0 },
    volunteerHours: { type: Number, default: 0 },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    status: { type: String, enum: ACTIVITY_STATUSES, default: 'upcoming' },
    image: { type: String, default: '' },
    requirements: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

const Activity = mongoose.model('Activity', activitySchema)
Activity.TYPES = ACTIVITY_TYPES
Activity.STATUSES = ACTIVITY_STATUSES

module.exports = Activity
