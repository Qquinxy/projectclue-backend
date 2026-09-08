const mongoose = require('mongoose')

const ACTIVITY_TYPES = ['volunteer', 'workshop', 'meeting', 'event', 'training']
const ACTIVITY_STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled']

// Normalizes the two image representations into one shape for every API
// response, so clients only ever have to read `images`:
//
//   - `images` (the current field) is an ordered list of paths/URLs.
//   - `image` (the legacy single-image field) is still written to disk on
//     documents created before multi-image support. When a document has no
//     `images` yet, the legacy value is surfaced as a one-element list, so
//     old activities keep displaying their picture with no migration.
//   - `image` is mirrored back as the first image (the cover) so any older
//     consumer still reading `activity.image` keeps working.
//
// Purely an output transform — nothing here writes to the database.
const normalizeImages = (doc, ret) => {
  const images = (Array.isArray(ret.images) ? ret.images : []).filter(
    (src) => typeof src === 'string' && src.trim() !== ''
  )
  if (images.length === 0 && typeof ret.image === 'string' && ret.image.trim() !== '') {
    images.push(ret.image.trim())
  }
  ret.images = images
  ret.image = images[0] || ''
  return ret
}

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
    // Ordered gallery. Index 0 is treated as the cover image.
    images: { type: [String], default: [] },
    // Legacy single-image field. Kept (not dropped) so existing documents are
    // never rewritten and no data is lost; new uploads only touch `images`.
    image: { type: String, default: '' },
    requirements: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

activitySchema.set('toJSON', { transform: normalizeImages })
activitySchema.set('toObject', { transform: normalizeImages })

const Activity = mongoose.model('Activity', activitySchema)
Activity.TYPES = ACTIVITY_TYPES
Activity.STATUSES = ACTIVITY_STATUSES

// Same normalization, usable on a plain document instance (not just on
// serialization) — controllers use it to answer with the effective list.
Activity.resolveImages = (activity) => {
  if (!activity) return []
  const images = (Array.isArray(activity.images) ? activity.images : []).filter(
    (src) => typeof src === 'string' && src.trim() !== ''
  )
  if (images.length === 0 && typeof activity.image === 'string' && activity.image.trim() !== '') {
    return [activity.image.trim()]
  }
  return images
}

module.exports = Activity
