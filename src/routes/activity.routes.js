const express = require('express')
const activityController = require('../controllers/activity.controller')
const participationController = require('../controllers/participation.controller')
const exportController = require('../controllers/export.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')

const router = express.Router()

router.get('/', activityController.listActivities)
router.get('/:id', activityController.getActivity)

// superadmin manages any activity; club_admin only activities under a club
// they manage — enforced inside the controller (assertManagesClub), since
// the relevant club must be resolved from the request body or the
// activity's existing `club` field.
router.post('/', authenticate, authorize('superadmin', 'club_admin'), activityController.createActivity)
router.patch('/:id', authenticate, authorize('superadmin', 'club_admin'), activityController.updateActivity)
router.delete('/:id', authenticate, authorize('superadmin', 'club_admin'), activityController.deleteActivity)

router.post('/:id/register', authenticate, authorize('student'), participationController.registerForActivity)
router.delete('/:id/register', authenticate, authorize('student'), participationController.cancelRegistration)
router.get(
  '/:id/participants',
  authenticate,
  authorize('superadmin', 'club_admin'),
  participationController.getActivityParticipants
)

// CSV / XLSX export of the same participant list. Club ownership of the
// activity is re-checked inside the controller (assertManagesClub), so a
// club_admin cannot export another club's activity by swapping the id.
router.get(
  '/:id/participants/export',
  authenticate,
  authorize('superadmin', 'club_admin'),
  exportController.exportActivityParticipants
)

module.exports = router
