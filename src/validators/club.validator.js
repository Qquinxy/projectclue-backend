const AppError = require('../utils/AppError')
const Club = require('../models/Club')

exports.validateClubInput = (body, { partial = false } = {}) => {
  const errors = []
  const { name, description, category, maxMembers } = body

  if (!partial || name !== undefined) {
    if (!name) errors.push('name is required')
  }
  if (!partial || description !== undefined) {
    if (!description) errors.push('description is required')
  }
  if (!partial || category !== undefined) {
    if (!category || !Club.CATEGORIES.includes(category)) {
      errors.push(`category must be one of: ${Club.CATEGORIES.join(', ')}`)
    }
  }
  if (!partial || maxMembers !== undefined) {
    if (maxMembers === undefined || isNaN(Number(maxMembers)) || Number(maxMembers) < 1) {
      errors.push('maxMembers must be a positive number')
    }
  }

  if (errors.length) throw new AppError(errors.join(', '), 400)
}
