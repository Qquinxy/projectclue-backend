const AppError = require('../utils/AppError')

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// New student registrations only — 11 digits, a dash, then 1 digit
// (e.g. 67543206105-8). Existing accounts with legacy studentId formats
// are untouched: this validator runs solely on the register path, not on
// club_admin creation, the seed script, or profile updates.
const STUDENT_ID_REGEX = /^[0-9]{11}-[0-9]$/

exports.validateRegisterInput = (body) => {
  const { studentId, firstName, lastName, email, password, faculty, major, year } = body
  const errors = []

  if (!studentId) errors.push('studentId is required')
  else if (!STUDENT_ID_REGEX.test(studentId)) errors.push('studentId must match the format 67543206105-8')
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
