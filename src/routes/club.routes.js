const express = require('express')
const clubController = require('../controllers/club.controller')
const membershipController = require('../controllers/membership.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')
const { uploadClubImage } = require('../middleware/upload')

const router = express.Router()

router.get('/', clubController.listClubs)
router.get('/:id', clubController.getClub)

// Creating/deleting clubs is superadmin-only. Editing is superadmin or a
// club_admin managing that specific club — enforced inside the controller
// via assertManagesClub, since it needs the club id from the route param.
router.post('/', authenticate, authorize('superadmin'), clubController.createClub)
router.patch('/:id', authenticate, authorize('superadmin', 'club_admin'), clubController.updateClub)
router.delete('/:id', authenticate, authorize('superadmin'), clubController.deleteClub)

// Image upload uses the same ownership rule as updateClub — superadmin any
// club, club_admin only a club they manage — enforced via assertManagesClub.
router.post(
  '/:id/image',
  authenticate,
  authorize('superadmin', 'club_admin'),
  uploadClubImage,
  clubController.uploadClubImage
)

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
