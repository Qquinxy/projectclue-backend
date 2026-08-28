const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, default: '' },
    faculty: { type: String, default: '' },
    major: { type: String, default: '' },
    year: { type: Number, default: 1 },
    role: { type: String, enum: ['student', 'club_admin', 'superadmin'], default: 'student' },
    profileImage: { type: String, default: '' },
    totalVolunteerHours: { type: Number, default: 0 },
    // Clubs a club_admin is responsible for. Kept array-shaped for payload
    // compatibility, but the business rule is a strict 1:1: a club_admin
    // manages at most one club (enforced here and in adminUser.validator.js/
    // adminUser.controller.js). Pre-existing documents with more than one
    // entry are left as-is; they're surfaced in the admin UI rather than
    // silently truncated.
    managedClubs: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Club',
      default: [],
      validate: {
        validator: (arr) => arr.length <= 1,
        message: 'A club admin may manage at most one club',
      },
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
