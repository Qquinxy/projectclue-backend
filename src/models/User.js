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
    // Clubs a club_admin is responsible for. Array-shaped so the system can
    // support multiple clubs per admin in the future, even though the
    // current workflow typically assigns one.
    managedClubs: { type: [mongoose.Schema.Types.ObjectId], ref: 'Club', default: [] },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
