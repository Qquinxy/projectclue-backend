const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { hasSuperadminPowers, getEffectiveRole } = require('../utils/adminAccess')

// authorize('superadmin') / authorize('student') — must run after authenticate.
//
// The role is resolved from the DATABASE, not from the JWT's `role` claim, so
// a role change takes effect on the very next request instead of whenever the
// user's token happens to expire. This is what makes "remove club admin"
// (role -> student) immediate in both directions: the removed account loses
// club_admin routes at once, and regains its student routes at once.
//
// A club_admin holding a verified Super Admin-equivalent elevation also
// satisfies a 'superadmin' requirement, so every existing superadmin-only
// route grants them access without any per-route change.
const authorize = (...roles) =>
  catchAsync(async (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401))
    }

    const role = await getEffectiveRole(req.user)
    if (!role) {
      return next(new AppError('Authentication required', 401))
    }

    // Keep req.user.role in step with the database for everything downstream.
    req.user.role = role

    if (roles.includes(role)) {
      return next()
    }

    if (roles.includes('superadmin') && (await hasSuperadminPowers(req.user))) {
      return next()
    }

    next(new AppError('You do not have permission to perform this action', 403))
  })

module.exports = authorize
