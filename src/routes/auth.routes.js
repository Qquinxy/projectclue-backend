const express = require('express')
const authController = require('../controllers/auth.controller')
const googleAuthController = require('../controllers/googleAuth.controller')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
router.post('/google', googleAuthController.googleLogin)
// Email verification is intentionally public: the caller is holding the
// emailed one-time token and has no session yet.
router.post('/verify-email', authController.verifyEmail)
router.post('/resend-verification', authController.resendVerification)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.getMe)
router.patch('/me', authenticate, authController.updateMe)

module.exports = router
