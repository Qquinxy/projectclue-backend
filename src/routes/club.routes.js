const express = require('express')
const clubController = require('../controllers/club.controller')
const membershipController = require('../controllers/membership.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')

const router = express.Router()

router.get('/', clubController.listClubs)
router.get('/:id', clubController.getClub)

// Creating/editing/deleting clubs is superadmin-only. club_admin manages
// activities, members, and attendance within an assigned club, but not the
// club record itself.
router.post('/', authenticate, authorize('superadmin'), clubController.createClub)
router.patch('/:id', authenticate, authorize('superadmin'), clubController.updateClub)
router.delete('/:id', authenticate, authorize('superadmin'), clubController.deleteClub)

router.post('/:id/join', authenticate, authorize('student'), membershipController.joinClub)
router.delete('/:id/leave', authenticate, authorize('student'), membershipController.leaveClub)

// club_admin may view members only of a club they manage — enforced inside
// the controller via assertManagesClub, since it needs the club id from
// the route param.
router.get(
  '/:id/members',
  authenticate,
  authorize('superadmin', 'club_admin'),
  membershipController.getClubMembers
)

module.exports = router
