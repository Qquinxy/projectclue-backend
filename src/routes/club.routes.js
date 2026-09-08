const express = require('express')
const clubController = require('../controllers/club.controller')
const membershipController = require('../controllers/membership.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')
const { uploadClubImage, uploadClubGalleryImages } = require('../middleware/upload')

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

// The club's own PHOTO GALLERY (Club.galleryImages) — separate from the
// single cover image above and from anything belonging to an Activity.
// Same ownership rule as updateClub: superadmin any club, club_admin only a
// club they manage, re-checked inside the controller via assertManagesClub.
// Students and anonymous visitors can read the gallery through GET /clubs/:id
// but are blocked from these two routes by authorize().
//
// Upload accepts multiple files in one multipart request under the "images"
// field; call it again to add more photos later.
router.post(
  '/:id/gallery-images',
  authenticate,
  authorize('superadmin', 'club_admin'),
  uploadClubGalleryImages,
  clubController.uploadClubGalleryImages
)
router.delete(
  '/:id/gallery-images',
  authenticate,
  authorize('superadmin', 'club_admin'),
  clubController.deleteClubGalleryImage
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
