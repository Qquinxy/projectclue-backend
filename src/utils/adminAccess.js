const User = require('../models/User')

// Single source of truth for "does this account have superadmin-level system
// permissions?".
//
// Two kinds of account qualify:
//   1. role === 'superadmin'          — the original, unchanged.
//   2. role === 'club_admin' with a VERIFIED elevation (elevatedAdmin === true)
//      — the Super Admin-equivalent appointment. A pending (unverified)
//      appointment deliberately grants nothing.
//
// The elevation flag is read fresh from the database on every call rather
// than from the JWT, matching how clubAccess.js resolves managedClubs: a
// superadmin revoking an elevation takes effect immediately instead of only
// after the appointee's token is re-issued.
// `user.role` is authoritative here: authorize() refreshes it from the
// database before any controller or downstream helper runs, so this only has
// to resolve the elevation flag.
exports.hasSuperadminPowers = async (user) => {
  if (!user) return false
  if (user.role === 'superadmin') return true
  if (user.role !== 'club_admin') return false

  const account = await User.findById(user.id).select('elevatedAdmin')
  return account?.elevatedAdmin === true
}

// The role a request should actually be judged by, read from the database
// rather than from the JWT's `role` claim.
//
// The claim is a snapshot from login time and can be up to JWT_EXPIRES_IN
// stale. That matters when a superadmin removes someone's club_admin
// position: without this, their existing cookie would keep asserting
// `club_admin` for days — and would simultaneously lock them out of the
// `student` routes their account has actually been returned to.
//
// Returns null when the account no longer exists, so callers deny access.
exports.getEffectiveRole = async (user) => {
  if (!user?.id) return null
  const account = await User.findById(user.id).select('role')
  return account?.role ?? null
}

// Only a real superadmin may grant or revoke elevation. An elevated
// club_admin deliberately cannot promote others, entrench itself, or demote
// the account that appointed it.
exports.isRootSuperadmin = (user) => user?.role === 'superadmin'

exports.MAX_ELEVATED_ADMINS = 2
