const AppError = require('../utils/AppError')
const Activity = require('../models/Activity')
const { isValidObjectId } = require('./validate')

exports.validateActivityInput = (body, { partial = false } = {}) => {
  const errors = []
  const { club, title, description, date, startTime, endTime, maxParticipants, type, status } = body

  if (!partial || club !== undefined) {
    if (!club || !isValidObjectId(club)) errors.push('a valid club id is required')
  }
  if (!partial || title !== undefined) {
    if (!title) errors.push('title is required')
  }
  if (!partial || description !== undefined) {
    if (!description) errors.push('description is required')
  }
  if (!partial || date !== undefined) {
    if (!date || isNaN(Date.parse(date))) errors.push('a valid date is required')
  }
  if (!partial || startTime !== undefined) {
    if (!startTime) errors.push('startTime is required')
  }
  if (!partial || endTime !== undefined) {
    if (!endTime) errors.push('endTime is required')
  }
  if (!partial || maxParticipants !== undefined) {
    if (maxParticipants === undefined || isNaN(Number(maxParticipants)) || Number(maxParticipants) < 1) {
      errors.push('maxParticipants must be a positive number')
    }
  }
  if (!partial || type !== undefined) {
    if (!type || !Activity.TYPES.includes(type)) {
      errors.push(`type must be one of: ${Activity.TYPES.join(', ')}`)
    }
  }
  if (status !== undefined && !Activity.STATUSES.includes(status)) {
    errors.push(`status must be one of: ${Activity.STATUSES.join(', ')}`)
  }

  if (errors.length) throw new AppError(errors.join(', '), 400)
}
