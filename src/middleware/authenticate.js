const { verifyToken } = require('../utils/jwt')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')

// Reads the JWT from the httpOnly cookie set at login. Never accepts a
// bearer token or localStorage-supplied credential — cookie is the only
// transport, per the approved authentication flow.
const authenticate = catchAsync(async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return next(new AppError('Authentication required', 401))
  }

  try {
    const decoded = verifyToken(token)
    req.user = { id: decoded.sub, role: decoded.role }
    next()
  } catch (err) {
    next(new AppError('Invalid or expired token', 401))
  }
})

module.exports = authenticate
