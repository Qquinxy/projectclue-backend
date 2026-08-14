const AppError = require('../utils/AppError')

// authorize('admin') / authorize('student') — must run after authenticate.
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401))
  }

  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action', 403))
  }

  next()
}

module.exports = authorize
