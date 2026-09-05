const { createVerificationToken } = require('../utils/verificationToken')
const emailService = require('./email.service')

// The ONE place that mints an email-confirmation token and hands the raw
// value to the mail service. Shared by:
//   - student registration            (auth.controller)
//   - club_admin account creation     (adminUser.controller)
//   - Super Admin-equivalent elevation(adminUser.controller)
//
// All three therefore use the same CSPRNG token, the same 24h expiry, the
// same hash-only storage, and the same single-use semantics — there is no
// second verification system anywhere in the codebase.

// Logs a delivery failure in a compact, sanitized form. The full nodemailer
// error (which echoes SMTP conversation details and transport config) is
// never logged and never leaves the server.
const logMailFailure = (context, err) => {
  console.error(`[email] ${context} failed: ${err?.code || err?.name || 'Error'}`)
}

// Email-address confirmation (registration + club_admin creation).
//
// The hash is persisted BEFORE the send is attempted, so a delivery failure
// still leaves the account in a consistent, resendable state. A token whose
// email never went out is harmless: it was never disclosed, it still expires
// in 24h, and the next resend replaces it.
const issueAndSendVerification = async (user) => {
  const { rawToken, tokenHash, expiresAt } = createVerificationToken()

  user.emailVerificationTokenHash = tokenHash
  user.emailVerificationExpires = expiresAt
  await user.save()

  await emailService.sendVerificationEmail({
    to: user.email,
    firstName: user.firstName,
    token: rawToken,
  })
}

// Super Admin-equivalent appointment confirmation. Same mechanics, separate
// token fields so an elevation link can never be mistaken for (or consume)
// an address-verification link.
const issueAndSendElevation = async (user) => {
  const { rawToken, tokenHash, expiresAt } = createVerificationToken()

  user.elevatedAdminPending = true
  user.elevatedAdminTokenHash = tokenHash
  user.elevatedAdminExpires = expiresAt
  await user.save()

  await emailService.sendElevationEmail({
    to: user.email,
    firstName: user.firstName,
    token: rawToken,
  })
}

module.exports = {
  logMailFailure,
  issueAndSendVerification,
  issueAndSendElevation,
}
