const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { signToken } = require('../utils/jwt')
const {
  NODE_ENV,
  FRONTEND_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = require('../config/env')

const COOKIE_NAME = 'token'
const STATE_COOKIE = 'oauth_state'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GOOGLE_STUDENT_ID_PREFIX = 'GC-'

const cookieOptions = () => ({
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
})

// The CSRF `state` cookie is short-lived and always SameSite=Lax so it rides
// along on the top-level GET navigation that the browser makes to the
// callback after Google's consent screen.
const stateCookieOptions = () => ({
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000,
})

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user }
  delete obj.passwordHash
  delete obj.emailVerificationTokenHash
  delete obj.emailVerificationExpires
  delete obj.elevatedAdminTokenHash
  delete obj.elevatedAdminExpires
  return obj
}

const frontendBase = () => FRONTEND_URL.replace(/\/+$/, '')

const assertGoogleConfigured = () => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new AppError('Google OAuth is not configured on the server', 500)
  }
}

// When GOOGLE_REDIRECT_URI is unset, derive it from the incoming request so
// the same callback works on localhost and behind a reverse proxy (the
// request URI is always that of the backend itself).
const redirectUriFor = (req) =>
  GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`

const clearStateCookie = (res) => {
  res.clearCookie(STATE_COOKIE, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
  })
}

// Keeps the auto-created student ID unique when real IDs are unknown. If the
// generated one somehow collides, append a random suffix and retry.
const generateStudentId = async (googleId) => {
  const base = `${GOOGLE_STUDENT_ID_PREFIX}${googleId.slice(-10)}`
  let candidate = base
  let tries = 0
  while (tries < 3 && (await User.findOne({ studentId: candidate }))) {
    tries += 1
    candidate = `${base.slice(0, -2)}${tries}${Math.floor(Math.random() * 90 + 10)}`
  }
  return candidate
}

// --- Step 1: send the user to Google's consent screen ---------------------

exports.redirectToGoogle = catchAsync(async (req, res, next) => {
  try {
    assertGoogleConfigured()
  } catch (err) {
    return next(err)
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie(STATE_COOKIE, state, stateCookieOptions())

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
  })

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
})

// --- Step 2: Google returns here; exchange the code for a session ---------

exports.googleCallback = catchAsync(async (req, res, next) => {
  const { code, state, error } = req.query
  const failRedirect = (errCode) => res.redirect(`${frontendBase()}/login?error=${errCode}`)

  // User cancelled / denied the Google consent prompt.
  if (error) return failRedirect('google_denied')

  // CSRF guard: the `state` must match the cookie we set in step 1.
  if (!state || !req.cookies?.[STATE_COOKIE] || state !== req.cookies[STATE_COOKIE]) {
    clearStateCookie(res)
    return failRedirect('google_state')
  }
  clearStateCookie(res)

  if (!code) return failRedirect('google_no_code')

  const redirectUri = redirectUriFor(req)

  // Exchange the authorization code for an access token.
  let profile
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) return failRedirect('google_token_failed')

    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!infoRes.ok) return failRedirect('google_userinfo_failed')
    profile = await infoRes.json()
  } catch {
    return failRedirect('google_failed')
  }

  // Google only provides the address if the account is verified; require it.
  const email = profile.email
  if (!email || profile.email_verified !== true) {
    return failRedirect('google_unverified_email')
  }

  // Link by Google ID first, then by email — so a Google sign-in on an
  // account that already has an email+password login links the two.
  let user = await User.findOne({ googleId: profile.sub })
  if (!user) {
    user = await User.findOne({ email: email.toLowerCase() })
  }

  if (user) {
    if (!user.googleId) {
      user.googleId = profile.sub
      if (profile.picture && !user.profileImage) user.profileImage = profile.picture
      await user.save()
    }
  } else {
    const studentId = await generateStudentId(profile.sub)
    user = await User.create({
      googleId: profile.sub,
      studentId,
      firstName: profile.given_name || 'Google',
      lastName: profile.family_name || 'User',
      email: email.toLowerCase(),
      // Not password-login capable (no password); the hash field is required
      // by the schema, so a random bcrypt hash marks Google-only accounts —
      // unknown to everyone, so email+password login can never succeed.
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
      role: 'student',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      profileImage: profile.picture || '',
    })
  }

  const jwtToken = signToken({ sub: user._id.toString(), role: user.role })
  res.cookie(COOKIE_NAME, jwtToken, cookieOptions())

  const isAdmin = user.role === 'superadmin' || user.role === 'club_admin'
  res.redirect(`${frontendBase()}${isAdmin ? '/admin' : '/dashboard'}`)
})