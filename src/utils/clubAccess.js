const User = require('../models/User')
const AppError = require('./AppError')
const { hasSuperadminPowers } = require('./adminAccess')

// Reusable club-scope check for the club_admin role.
//
// - superadmin: always allowed.
// - club_admin: allowed only if clubId is in their managedClubs. Fetched
//   fresh from the database on every call (not read off the JWT), so that
//   a superadmin reassigning a club_admin's clubs takes effect immediately
//   rather than only after the admin's token is re-issued.
// - any other role: denied.
//
// Throws AppError(403) on denial; callers await this before mutating.
exports.assertManagesClub = async (user, clubId) => {
  if (!clubId) throw new AppError('Club not found', 404)

  // superadmin, or a club_admin holding a verified Super Admin-equivalent
  // elevation, may manage any club.
  if (await hasSuperadminPowers(user)) return

  if (user.role === 'club_admin') {
    const admin = await User.findById(user.id).select('managedClubs')
    const managed = (admin?.managedClubs || []).map((id) => id.toString())
    if (managed.includes(clubId.toString())) return
  }

  throw new AppError('You do not have permission to manage this club', 403)
}
