const crypto = require('crypto')

// 32 random bytes (256 bits) from the CSPRNG, hex-encoded for use in a URL.
const TOKEN_BYTES = 32
const TTL_HOURS = 24

// Only the hash is persisted. Someone with read access to the users
// collection therefore cannot mint a working verification link, and the raw
// token exists only in the email that was sent.
exports.hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex')

exports.createVerificationToken = () => {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  return {
    rawToken,
    tokenHash: exports.hashToken(rawToken),
    expiresAt: new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000),
  }
}

exports.VERIFICATION_TTL_HOURS = TTL_HOURS
