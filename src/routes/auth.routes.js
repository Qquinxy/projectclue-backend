const express = require('express')
const authController = require('../controllers/auth.controller')
const googleAuthController = require('../controllers/googleAuth.controller')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
// Google OAuth — step 1 (send to Google's consent screen) and step 2
// (callback after consent). The backend performs the whole OAuth dance and
// redirects the browser back to the frontend with a session cookie set.
router.get('/google', googleAuthController.redirectToGoogle)
router.get('/google/callback', googleAuthController.googleCallback)
// Email verification is intentionally public: the caller is holding the
// emailed one-time token and has no session yet.
router.post('/verify-email', authController.verifyEmail)
router.post('/resend-verification', authController.resendVerification)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.getMe)
router.patch('/me', authenticate, authController.updateMe)

module.exports = router
