const express = require('express')
const referenceController = require('../controllers/reference.controller')

const router = express.Router()

// Public list of selectable faculties / years / majors — needed by the
// register form before a user has any session, so deliberately unauthenticated.
router.get('/', referenceController.listReference)

module.exports = router