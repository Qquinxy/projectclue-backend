const AppError = require('../utils/AppError')

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

exports.validateRegisterInput = (body) => {
  const { studentId, firstName, lastName, email, password, faculty, major, year } = body
  const errors = []

  if (!studentId) errors.push('studentId is required')
  if (!firstName) errors.push('firstName is required')
  if (!lastName) errors.push('lastName is required')
  if (!email || !EMAIL_REGEX.test(email)) errors.push('a valid email is required')
  if (!password || password.length < 6) errors.push('password must be at least 6 characters')
  if (!faculty) errors.push('faculty is required')
  if (!major) errors.push('major is required')
  if (year === undefined || year === null || isNaN(Number(year))) errors.push('year must be a number')

  if (errors.length) throw new AppError(errors.join(', '), 400)
}

exports.validateLoginInput = (body) => {
  const { email, password } = body
  const errors = []

  if (!email) errors.push('email is required')
  if (!password) errors.push('password is required')

  if (errors.length) throw new AppError(errors.join(', '), 400)
}
