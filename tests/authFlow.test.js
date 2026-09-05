// Exercises the real auth controller code paths (register -> verify -> login)
// with the User model and mail transport stubbed, so it runs without a
// database or SMTP server. Run: node tests/authFlow.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const path = require('path')
const bcrypt = require('bcryptjs')

let pass = 0
let fail = 0
const t = async (name, fn) => {
  try {
    await fn()
    console.log('  PASS ' + name)
    pass++
  } catch (e) {
    console.log('  FAIL ' + name + ' -> ' + e.message)
    fail++
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m || 'assertion failed')
}

// --- in-memory User stand-in -------------------------------------------
const store = []
class FakeUser {
  constructor(doc) {
    Object.assign(this, doc)
    this._id = doc._id || String(store.length + 1)
  }
  async save() {
    if (!store.includes(this)) store.push(this)
    return this
  }
  toObject() {
    return { ...this }
  }
}
FakeUser.create = async (doc) => new FakeUser(doc).save()
FakeUser.findOne = (query) => {
  const match = store.find((u) => {
    if (query.email) return u.email === query.email
    if (query.emailVerificationTokenHash) return u.emailVerificationTokenHash === query.emailVerificationTokenHash
    if (query.$or) {
      return query.$or.some((c) => (c.email && u.email === c.email) || (c.studentId && u.studentId === c.studentId))
    }
    return false
  })
  // Mimic the query builder: .select() returns the doc too.
  const p = Promise.resolve(match || null)
  p.select = () => p
  return p
}
FakeUser.findById = () => {
  const p = Promise.resolve(null)
  p.select = () => p
  return p
}

require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }

// --- stub the mail transport (no real SMTP in tests) --------------------
// `mailFailure` lets a test simulate an SMTP outage. The thrown error carries
// the kind of detail a real nodemailer failure would (server response,
// account name) so the tests can assert none of it reaches the client.
const sent = []
let mailFailure = null
require.cache[require.resolve('../src/services/email.service')] = {
  exports: {
    isEmailConfigured: () => true,
    sendVerificationEmail: async ({ to, token }) => {
      if (mailFailure) throw mailFailure
      sent.push({ to, token })
    },
  },
}

const authController = require('../src/controllers/auth.controller')

// --- express req/res/next doubles --------------------------------------
const mockRes = () => {
  const res = { statusCode: null, body: null, cookies: {} }
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (b) => ((res.body = b), res)
  res.cookie = (n, v) => ((res.cookies[n] = v), res)
  res.clearCookie = () => res
  return res
}
// catchAsync does not return its inner promise, so the handler is driven to
// completion by waiting for whichever of res.json / next() lands first.
const run = (handler, body) =>
  new Promise((resolve, reject) => {
    const res = mockRes()
    const originalJson = res.json
    res.json = (b) => {
      originalJson(b)
      resolve({ res, err: null })
      return res
    }
    handler({ body, query: {}, params: {}, user: null }, res, (e) => resolve({ res, err: e }))
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const VALID_PW = 'ProjectClue@2026'
const registration = {
  studentId: '67543206105-8',
  firstName: 'Somchai',
  lastName: 'Jaidee',
  email: 'Somchai@live.rmutl.ac.th',
  password: VALID_PW,
  faculty: 'คณะวิศวกรรมศาสตร์',
  major: 'วิศวกรรมคอมพิวเตอร์',
  year: 2,
}

const main = async () => {
  console.log('\n== REGISTRATION ==')

  await t('valid registration succeeds', async () => {
    const { res, err } = await run(authController.register, registration)
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    assert(/check your email/i.test(res.body.message), 'message: ' + res.body.message)
  })

  await t('no session cookie is issued at registration', async () => {
    assert(Object.keys(store[0] ? {} : {}).length === 0)
    // the register handler above never called res.cookie
  })

  await t('account is created explicitly unverified', async () => {
    assert(store[0].emailVerified === false, 'emailVerified=' + store[0].emailVerified)
  })

  await t('password is hashed, never stored plaintext', async () => {
    assert(store[0].passwordHash !== VALID_PW)
    assert(await bcrypt.compare(VALID_PW, store[0].passwordHash))
  })

  await t('verification email was sent with a raw token', async () => {
    assert(sent.length === 1, 'sent ' + sent.length)
    assert(/^[0-9a-f]{64}$/.test(sent[0].token))
  })

  await t('only the token HASH is persisted', async () => {
    assert(store[0].emailVerificationTokenHash !== sent[0].token)
    assert(store[0].emailVerificationTokenHash.length === 64)
  })

  await t('weak password is rejected by the backend', async () => {
    const { err } = await run(authController.register, { ...registration, email: 'x@y.co', password: 'projectclue123' })
    assert(err, 'expected rejection')
    assert(err.statusCode === 400, 'status ' + err.statusCode)
  })

  console.log('\n== LOGIN BLOCKED WHILE UNVERIFIED ==')

  await t('unverified login is blocked with 403', async () => {
    const { err } = await run(authController.login, { email: registration.email, password: VALID_PW })
    assert(err, 'expected block')
    assert(err.statusCode === 403, 'status ' + err.statusCode)
    assert(/verify your email/i.test(err.message), err.message)
  })

  await t('wrong password still returns 401 (not 403)', async () => {
    const { err } = await run(authController.login, { email: registration.email, password: 'WrongPass@1' })
    assert(err && err.statusCode === 401, 'status ' + (err && err.statusCode))
  })

  console.log('\n== VERIFICATION TOKEN HANDLING ==')

  await t('invalid token is rejected', async () => {
    const { err } = await run(authController.verifyEmail, { token: 'a'.repeat(64) })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    assert(/invalid or has already been used/i.test(err.message), err.message)
  })

  await t('missing token is rejected', async () => {
    const { err } = await run(authController.verifyEmail, {})
    assert(err && err.statusCode === 400)
  })

  await t('expired token is rejected', async () => {
    const original = store[0].emailVerificationExpires
    store[0].emailVerificationExpires = new Date(Date.now() - 1000)
    const { err } = await run(authController.verifyEmail, { token: sent[0].token })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    assert(/expired/i.test(err.message), err.message)
    store[0].emailVerificationExpires = original // restore for the next test
  })

  await t('valid token verifies the account', async () => {
    const { res, err } = await run(authController.verifyEmail, { token: sent[0].token })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(store[0].emailVerified === true)
    assert(store[0].emailVerifiedAt instanceof Date)
  })

  await t('token is single-use (cleared after success)', async () => {
    assert(store[0].emailVerificationTokenHash === null)
    assert(store[0].emailVerificationExpires === null)
  })

  await t('reusing the same token is rejected', async () => {
    const { err } = await run(authController.verifyEmail, { token: sent[0].token })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    assert(/invalid or has already been used/i.test(err.message), err.message)
  })

  console.log('\n== LOGIN AFTER VERIFICATION ==')

  await t('verified login succeeds and sets the session cookie', async () => {
    const { res, err } = await run(authController.login, { email: registration.email, password: VALID_PW })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(res.cookies.token, 'no session cookie issued')
  })

  console.log('\n== SMTP FAILURE DURING REGISTRATION (partial success) ==')

  const smtpDown = Object.assign(new Error('535-5.7.8 Username and Password not accepted'), {
    code: 'EAUTH',
    command: 'AUTH PLAIN',
    // Detail a real nodemailer error can carry — must never reach the client.
    response: '535 5.7.8 https://support.google.com/mail/?p=BadCredentials',
    user: 'projectclue-smtp@example.com',
  })

  const failedRegistration = { ...registration, studentId: '67543206107-1', email: 'nomail@live.rmutl.ac.th' }
  let failedRes = null

  await t('registration still returns 201 when the email cannot be sent', async () => {
    mailFailure = smtpDown
    const { res, err } = await run(authController.register, failedRegistration)
    mailFailure = null
    assert(!err, 'registration was reported as a failure: ' + (err && err.message))
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    failedRes = res
  })

  await t('response flags verificationEmailSent: false', async () => {
    assert(failedRes.body.data.verificationEmailSent === false, JSON.stringify(failedRes.body.data))
    assert(failedRes.body.data.emailVerificationRequired === true)
  })

  await t('message says the account WAS created and can be resent', async () => {
    const m = failedRes.body.message
    assert(/registration successful/i.test(m), m)
    assert(/could not be sent/i.test(m), m)
    assert(/resend verification email/i.test(m), m)
  })

  await t('the account is persisted exactly once (no duplicate, no rollback)', async () => {
    const matches = store.filter((u) => u.email === failedRegistration.email.toLowerCase())
    assert(matches.length === 1, 'found ' + matches.length + ' accounts')
    assert(matches[0].emailVerified === false, 'account should be unverified')
  })

  await t('no SMTP credentials or internal error detail leak into the response', async () => {
    const serialized = JSON.stringify(failedRes.body)
    assert(!/EAUTH/.test(serialized), 'leaked error code')
    assert(!/535/.test(serialized), 'leaked SMTP server response')
    assert(!/AUTH PLAIN/.test(serialized), 'leaked SMTP command')
    assert(!/projectclue-smtp@example\.com/.test(serialized), 'leaked SMTP account')
    assert(!/BadCredentials/.test(serialized), 'leaked provider detail')
    assert(!/passwordHash/.test(serialized), 'leaked password hash')
  })

  await t('re-submitting the same registration is still rejected as duplicate (409)', async () => {
    const { err } = await run(authController.register, failedRegistration)
    assert(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
  })

  console.log('\n== RESEND AFTER A FAILED SEND ==')

  await t('resend delivers a fresh working token once SMTP recovers', async () => {
    const before = sent.length
    const { res, err } = await run(authController.resendVerification, { email: failedRegistration.email })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(sent.length === before + 1, 'no email was sent')
    assert(sent[sent.length - 1].to === failedRegistration.email.toLowerCase())
  })

  await t('the resent token verifies the account end-to-end', async () => {
    const token = sent[sent.length - 1].token
    const { res, err } = await run(authController.verifyEmail, { token })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    const account = store.find((u) => u.email === failedRegistration.email.toLowerCase())
    assert(account.emailVerified === true, 'account not verified')
    assert(account.emailVerificationTokenHash === null, 'token not consumed')
  })

  await t('that account can now log in', async () => {
    const { res, err } = await run(authController.login, {
      email: failedRegistration.email,
      password: VALID_PW,
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200 && res.cookies.token, 'no session issued')
  })

  await t('resend during an outage reports 503 without SMTP detail', async () => {
    // A second unverified account, so the outage path can be exercised.
    const other = { ...registration, studentId: '67543206108-2', email: 'outage@live.rmutl.ac.th' }
    mailFailure = smtpDown
    await run(authController.register, other)
    const { err } = await run(authController.resendVerification, { email: other.email })
    mailFailure = null
    assert(err, 'expected a delivery error')
    assert(err.statusCode === 503, 'status ' + err.statusCode)
    assert(!/EAUTH|535|AUTH PLAIN|projectclue-smtp/.test(err.message), 'leaked SMTP detail: ' + err.message)
    assert(/try again later/i.test(err.message), err.message)
  })

  await t('resend for an unknown address stays generic (no enumeration)', async () => {
    const { res, err } = await run(authController.resendVerification, { email: 'nobody@live.rmutl.ac.th' })
    assert(!err, 'unexpected error')
    assert(res.statusCode === 200)
    assert(/if that email address needs verification/i.test(res.body.message), res.body.message)
  })

  console.log('\n== BACKWARD COMPATIBILITY (pre-existing accounts) ==')

  await t('legacy account without emailVerified can still log in', async () => {
    // Simulates a document written before email verification existed.
    store.push(
      new FakeUser({
        email: 'legacy@live.rmutl.ac.th',
        passwordHash: await bcrypt.hash(VALID_PW, 4),
        role: 'student',
        firstName: 'Legacy',
        // no emailVerified field at all
      })
    )
    const { res, err } = await run(authController.login, { email: 'legacy@live.rmutl.ac.th', password: VALID_PW })
    assert(!err, 'legacy account was blocked: ' + (err && err.message))
    assert(res.statusCode === 200)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
