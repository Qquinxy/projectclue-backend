const express = require('express')
const adminController = require('../controllers/admin.controller')
const participationController = require('../controllers/participation.controller')
const adminUserController = require('../controllers/adminUser.controller')
const referenceController = require('../controllers/reference.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')

const router = express.Router()

router.use(authenticate)

// Dashboard stats: superadmin gets system-wide counts, club_admin gets
// counts scoped to their managedClubs (branching happens in the controller).
router.get('/stats', authorize('superadmin', 'club_admin'), adminController.getStats)

// Viewing an arbitrary student's volunteer-hour history is system-wide
// data, not a listed club_admin capability — superadmin only.
router.get(
  '/students/:id/volunteer-hours',
  authorize('superadmin'),
  participationController.getStudentVolunteerHoursAdmin
)

// Attendance marking: superadmin for any activity, club_admin only for
// activities under a club they manage — enforced in the controller by
// resolving participation -> activity -> club.
router.patch(
  '/participations/:id/attend',
  authorize('superadmin', 'club_admin'),
  participationController.markAttended
)
router.patch(
  '/participations/:id/absent',
  authorize('superadmin', 'club_admin'),
  participationController.markAbsent
)

// Club admin account management — superadmin only. No public/self-service
// path creates club_admin or superadmin accounts.
router.get('/users', authorize('superadmin'), adminUserController.listClubAdmins)
router.post('/users', authorize('superadmin'), adminUserController.createClubAdmin)
router.patch('/users/:id', authorize('superadmin'), adminUserController.updateClubAdmin)
// Revokes the club_admin position (role -> student) — it does NOT delete the
// account or any membership/participation history. Same URL as before so no
// client changes are required.
router.delete('/users/:id', authorize('superadmin'), adminUserController.removeClubAdmin)
router.patch('/users/:id/clubs', authorize('superadmin'), adminUserController.assignClubs)

// Super Admin-equivalent appointment. authorize('superadmin') lets an
// elevated club_admin through, so the controller additionally requires a
// real superadmin — an elevated admin cannot appoint or demote anyone.
router.post('/users/:id/elevate', authorize('superadmin'), adminUserController.elevateClubAdmin)
router.delete('/users/:id/elevate', authorize('superadmin'), adminUserController.revokeClubAdminElevation)

// Reference data (faculties / years / majors) — managed by superadmin. The
// public list endpoint lives in reference.routes.js.
router.get('/reference-data', authorize('superadmin'), referenceController.adminList)
router.post('/reference-data', authorize('superadmin'), referenceController.createReference)
router.patch('/reference-data/:id', authorize('superadmin'), referenceController.updateReference)
router.delete('/reference-data/:id', authorize('superadmin'), referenceController.deleteReference)

module.exports = router
