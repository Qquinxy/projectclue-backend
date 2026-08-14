const { NODE_ENV } = require('../config/env')

// Centralized error handler. Normalizes Mongoose errors into consistent
// HTTP responses and never leaks stack traces outside development.
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500
  let message = err.message || 'Internal server error'

  if (err.name === 'ValidationError') {
    statusCode = 400
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ')
  }

  if (err.code === 11000) {
    statusCode = 409
    const field = Object.keys(err.keyValue || {}).join(', ')
    message = `Duplicate value for field: ${field}`
  }

  if (err.name === 'CastError') {
    statusCode = 400
    message = `Invalid ${err.path}: ${err.value}`
  }

  if (NODE_ENV !== 'production') {
    console.error(err)
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
  })
}

module.exports = errorHandler
