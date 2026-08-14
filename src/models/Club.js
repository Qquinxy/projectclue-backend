const mongoose = require('mongoose')

const CLUB_CATEGORIES = ['volunteer', 'academic', 'sports', 'arts', 'technology', 'social']

const clubSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: { type: String, enum: CLUB_CATEGORIES, required: true },
    image: { type: String, default: '' },
    memberCount: { type: Number, default: 0 },
    maxMembers: { type: Number, required: true },
    advisorName: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    meetingSchedule: { type: String, default: '' },
    location: { type: String, default: '' },
    requirements: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

const Club = mongoose.model('Club', clubSchema)
Club.CATEGORIES = CLUB_CATEGORIES

module.exports = Club
