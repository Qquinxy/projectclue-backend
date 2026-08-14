const jwt = require('jsonwebtoken')
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env')

exports.signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })

exports.verifyToken = (token) => jwt.verify(token, JWT_SECRET)
