const express = require('express')
const membershipController = require('../controllers/membership.controller')
const participationController = require('../controllers/participation.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')

const router = express.Router()

router.use(authenticate, authorize('student'))

router.get('/me/clubs', membershipController.getMyClubs)
router.get('/me/activities', participationController.getMyActivities)
router.get('/me/volunteer-hours', participationController.getMyVolunteerHours)

module.exports = router
