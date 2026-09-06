const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    clerkId: { type: String, default: null, sparse: true },
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

    // --- Email verification ---------------------------------------------
    // No schema default on purpose: accounts created before email
    // verification existed have no `emailVerified` field at all, and stay
    // `undefined` when hydrated. Login only blocks on an explicit `false`,
    // so those legacy accounts keep working untouched while every new
    // registration is written with `emailVerified: false`.
    emailVerified: { type: Boolean, default: undefined },
    emailVerifiedAt: { type: Date, default: null },
    // Only the SHA-256 hash of the verification token is stored; the raw
    // token exists solely inside the verification email. Both fields are
    // cleared the moment a token is consumed, which makes tokens single-use.
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpires: { type: Date, default: null, select: false },

    // --- Super Admin-equivalent elevation (club_admin only) --------------
    // Grants superadmin-level system permissions WITHOUT changing `role`,
    // so the existing role enum, club_admin behaviour and multi-club
    // support are all left intact. At most 2 accounts may hold this at
    // once (enforced in adminUser.controller.js, counting both active
    // holders and pending appointments).
    //
    // An appointment only becomes active after the appointee confirms it by
    // email, reusing the same token utilities, mail service and
    // /auth/verify-email endpoint as registration. Until then
    // `elevatedAdminPending` is true and `elevatedAdmin` is not.
    elevatedAdmin: { type: Boolean, default: undefined },
    elevatedAdminGrantedAt: { type: Date, default: null },
    elevatedAdminPending: { type: Boolean, default: undefined },
    elevatedAdminTokenHash: { type: String, default: null, select: false },
    elevatedAdminExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
