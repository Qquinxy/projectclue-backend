const mongoose = require('mongoose')
const AppError = require('../utils/AppError')

exports.isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id)

exports.validateObjectId = (paramName = 'id') => (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params[paramName])) {
    return next(new AppError(`Invalid ${paramName}`, 400))
  }
  next()
}
