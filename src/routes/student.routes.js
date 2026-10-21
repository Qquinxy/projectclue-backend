const express = require('express')
const membershipController = require('../controllers/membership.controller')
const participationController = require('../controllers/participation.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')
const { uploadActivityEvidence } = require('../middleware/upload')

const router = express.Router()

router.use(authenticate, authorize('student'))

router.get('/me/clubs', membershipController.getMyClubs)
router.get('/me/activities', participationController.getMyActivities)
router.get('/me/volunteer-hours', participationController.getMyVolunteerHours)

// Students may only manage evidence for a participation owned by their
// authenticated account. Evidence bytes are served through an authorized API.
router.post(
  '/me/participations/:id/evidence',
  authorize('student'),
  participationController.loadOwnEvidenceParticipation,
  uploadActivityEvidence,
  participationController.uploadActivityEvidence
)
router.get(
  '/me/participations/:id/evidence',
  authorize('student'),
  participationController.loadOwnEvidenceParticipation,
  participationController.getActivityEvidence
)
router.delete(
  '/me/participations/:id/evidence',
  authorize('student'),
  participationController.loadOwnEvidenceParticipation,
  participationController.deleteActivityEvidence
)
module.exports = router
