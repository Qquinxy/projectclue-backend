// Single source of truth for the password policy, shared by every path that
// accepts a new password (student registration, club_admin creation, the
// seed:admin script). The frontend mirrors these rules in lib/password.ts,
// but this file is the one that actually enforces them — a client that skips
// the frontend still has to pass through here.
//
// Policy: at least 8 characters, with at least one uppercase letter, one
// lowercase letter, one digit and one special character (e.g. @ ! _ # $ %).

const MIN_LENGTH = 8

const RULES = [
  { test: (pw) => pw.length >= MIN_LENGTH, message: `password must be at least ${MIN_LENGTH} characters` },
  { test: (pw) => /[A-Z]/.test(pw), message: 'password must contain at least one uppercase letter (A-Z)' },
  { test: (pw) => /[a-z]/.test(pw), message: 'password must contain at least one lowercase letter (a-z)' },
  { test: (pw) => /[0-9]/.test(pw), message: 'password must contain at least one number (0-9)' },
  {
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
    message: 'password must contain at least one special character (e.g. @ ! _ # $ %)',
  },
]

// Returns an array of human-readable problems; empty array means the
// password satisfies the policy.
exports.getPasswordErrors = (password) => {
  if (typeof password !== 'string' || password.length === 0) {
    return ['password is required']
  }
  return RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message)
}

exports.isStrongPassword = (password) => exports.getPasswordErrors(password).length === 0

exports.PASSWORD_MIN_LENGTH = MIN_LENGTH
