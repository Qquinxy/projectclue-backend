const AppError = require('../utils/AppError')
const { isValidObjectId } = require('./validate')

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const validateManagedClubsShape = (managedClubs) =>
  Array.isArray(managedClubs) && managedClubs.every((id) => isValidObjectId(id))

exports.validateCreateClubAdminInput = (body) => {
  const { studentId, firstName, lastName, email, password, managedClubs } = body
  const errors = []

  if (!studentId) errors.push('studentId is required')
  if (!firstName) errors.push('firstName is required')
  if (!lastName) errors.push('lastName is required')
  if (!email || !EMAIL_REGEX.test(email)) errors.push('a valid email is required')
  if (!password || password.length < 6) errors.push('password must be at least 6 characters')
  if (managedClubs !== undefined && !validateManagedClubsShape(managedClubs)) {
    errors.push('managedClubs must be an array of valid club ids')
  }

  if (errors.length) throw new AppError(errors.join(', '), 400)
}

exports.validateUpdateClubAdminInput = (body) => {
  const { email } = body
  if (email !== undefined && !EMAIL_REGEX.test(email)) {
    throw new AppError('a valid email is required', 400)
  }
}

exports.validateAssignClubsInput = (body) => {
  if (!validateManagedClubsShape(body.managedClubs)) {
    throw new AppError('managedClubs must be an array of valid club ids', 400)
  }
}
