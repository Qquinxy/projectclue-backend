const { verifyToken, createClerkClient } = require('@clerk/backend')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { signToken } = require('../utils/jwt')
const { NODE_ENV, CLERK_SECRET_KEY } = require('../config/env')

const COOKIE_NAME = 'token'
const GOOGLE_STUDENT_ID_PREFIX = 'GC-'

const cookieOptions = () => ({
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
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

const clerkClient = () => (CLERK_SECRET_KEY ? createClerkClient({ secretKey: CLERK_SECRET_KEY }) : null)

// Keeps the auto-created student ID unique when real IDs are unknown. If the
// generated one somehow collides, append a random suffix and retry.
const generateStudentId = async (clerkUserId) => {
  const base = `${GOOGLE_STUDENT_ID_PREFIX}${clerkUserId.slice(-10)}`
  let candidate = base
  let tries = 0
  // The User model tolerates any string; uniqueness is the only constraint.
  while (tries < 3 && (await User.findOne({ studentId: candidate }))) {
    tries += 1
    candidate = `${base.slice(0, -2)}${tries}${Math.floor(Math.random() * 90 + 10)}`
  }
  return candidate
}

exports.googleLogin = catchAsync(async (req, res, next) => {
  const { token: clerkToken } = req.body

  if (!clerkToken || typeof clerkToken !== 'string') {
    return next(new AppError('Clerk session token is required', 400))
  }

  const client = clerkClient()
  if (!client) {
    return next(new AppError('Clerk is not configured on the server', 500))
  }

  let clerkUserId
  try {
    const sessionPayload = await verifyToken(clerkToken, { secretKey: CLERK_SECRET_KEY })
    clerkUserId = sessionPayload.sub
  } catch {
    return next(new AppError('Invalid or expired Clerk token', 401))
  }

  // Session tokens carry no profile claims — fetch the real user from Clerk.
  let clerkUser
  try {
    clerkUser = await client.users.getUser(clerkUserId)
  } catch {
    return next(new AppError('Could not verify the Google account', 401))
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses?.[0]?.emailAddress
  if (!email) {
    return next(new AppError('No email found on the Google account', 400))
  }

  const firstName = clerkUser.firstName || ''
  const lastName = clerkUser.lastName || ''
  const imageUrl = clerkUser.imageUrl || ''

  // Find the existing account by Clerk ID first, then by email — so a
  // Google sign-in on an account that already has an email+password login
  // links the two identities.
  let user = await User.findOne({ clerkId: clerkUserId })
  if (!user) {
    user = await User.findOne({ email: email.toLowerCase() })
  }

  if (user) {
    if (!user.clerkId) {
      user.clerkId = clerkUserId
      if (imageUrl && !user.profileImage) user.profileImage = imageUrl
      await user.save()
    }
  } else {
    const studentId = await generateStudentId(clerkUserId)
    user = await User.create({
      clerkId: clerkUserId,
      studentId,
      firstName: firstName || 'Google',
      lastName: lastName || 'User',
      email: email.toLowerCase(),
      // Not password-login capable (no password); the hash field is required
      // by the schema, so a random bcrypt hash marks Google-only accounts —
      // unknown to everyone, so email+password login can never succeed.
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
      role: 'student',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      profileImage: imageUrl,
    })
  }

  const jwtToken = signToken({ sub: user._id.toString(), role: user.role })
  res.cookie(COOKIE_NAME, jwtToken, cookieOptions())

  success(res, 200, { user: sanitizeUser(user) }, 'Google login successful')
})