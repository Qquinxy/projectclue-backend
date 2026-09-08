const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, default: null, sparse: true },
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
    // Clubs a club_admin is responsible for. A club_admin may manage many
    // clubs, and a club may be managed by more than one club_admin — there
    // is deliberately no cardinality limit here. Every club-scoped backend
    // operation authorizes against this array via utils/clubAccess.js.
    managedClubs: { type: [mongoose.Schema.Types.ObjectId], ref: 'Club', default: [] },

    // --- Email verification status ---------------------------------------
    // Email verification was removed from the system, but these two fields
    // are retained: the Google OAuth flow writes them
    // (googleAuth.controller.js), registration and club_admin creation now
    // write `true`, and existing documents already carry them. Nothing reads
    // them as a login gate any more. No schema default, so documents written
    // before verification existed keep hydrating as `undefined`.
    emailVerified: { type: Boolean, default: undefined },
    emailVerifiedAt: { type: Date, default: null },

    // --- Super Admin-equivalent elevation (club_admin only) --------------
    // Grants superadmin-level system permissions WITHOUT changing `role`,
    // so the existing role enum, club_admin behaviour and multi-club
    // support are all left intact. At most 2 accounts may hold this at once
    // (enforced in adminUser.controller.js).
    //
    // A grant from a root superadmin now activates immediately; there is no
    // email-confirmation step and therefore no pending state.
    elevatedAdmin: { type: Boolean, default: undefined },
    elevatedAdminGrantedAt: { type: Date, default: null },
    // Legacy only. The retired email-confirmation flow parked an appointment
    // here until the appointee clicked through. Nothing sets it to true any
    // more, and it grants no permissions, but it is kept in the schema so
    // that documents which still carry it hydrate correctly and can be
    // cleared through the revoke route.
    elevatedAdminPending: { type: Boolean, default: undefined },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
