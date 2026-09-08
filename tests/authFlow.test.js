// Exercises the real auth controller code paths (register -> login) with the
// User model stubbed, so it runs without a database. Email verification has
// been removed from the system, so these tests assert the opposite of the old
// ones: accounts are usable immediately and no mail is ever sent.
// Run: node tests/authFlow.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const fs = require('fs')
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

  let registerRes = null

  await t('valid registration succeeds', async () => {
    const { res, err } = await run(authController.register, registration)
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    registerRes = res
  })

  await t('message tells the user they can log in now', async () => {
    const m = registerRes.body.message
    assert(/registration successful/i.test(m), m)
    assert(/can now log in/i.test(m), m)
    assert(!/verif/i.test(m), 'message still mentions verification: ' + m)
    assert(!/email/i.test(m), 'message still mentions email: ' + m)
  })

  await t('account is created already verified', async () => {
    assert(store[0].emailVerified === true, 'emailVerified=' + store[0].emailVerified)
    assert(store[0].emailVerifiedAt instanceof Date, 'emailVerifiedAt not set')
  })

  await t('no verification token fields are written', async () => {
    assert(store[0].emailVerificationTokenHash === undefined, 'token hash was written')
    assert(store[0].emailVerificationExpires === undefined, 'token expiry was written')
  })

  await t('response carries no verification fields', async () => {
    const d = registerRes.body.data
    assert(d.verificationEmailSent === undefined, 'verificationEmailSent still returned')
    assert(d.emailVerificationRequired === undefined, 'emailVerificationRequired still returned')
  })

  await t('no session cookie is issued at registration', async () => {
    assert(Object.keys(registerRes.cookies).length === 0, 'registration issued a session')
  })

  await t('password is hashed, never stored plaintext', async () => {
    assert(store[0].passwordHash !== VALID_PW)
    assert(await bcrypt.compare(VALID_PW, store[0].passwordHash))
  })

  await t('no password hash leaks into the response', async () => {
    assert(!/passwordHash/.test(JSON.stringify(registerRes.body)), 'leaked password hash')
  })

  await t('weak password is rejected by the backend', async () => {
    const { err } = await run(authController.register, { ...registration, email: 'x@y.co', password: 'projectclue123' })
    assert(err, 'expected rejection')
    assert(err.statusCode === 400, 'status ' + err.statusCode)
  })

  await t('duplicate registration is rejected as 409', async () => {
    const { err } = await run(authController.register, registration)
    assert(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
  })

  console.log('\n== LOGIN IS IMMEDIATE (no verification gate) ==')

  await t('the freshly registered account can log in right away', async () => {
    const { res, err } = await run(authController.login, { email: registration.email, password: VALID_PW })
    assert(!err, 'login was blocked: ' + (err && err.message))
    assert(res.statusCode === 200, 'status ' + res.statusCode)
    assert(res.cookies.token, 'no session cookie issued')
  })

  await t('wrong password returns 401', async () => {
    const { err } = await run(authController.login, { email: registration.email, password: 'WrongPass@1' })
    assert(err && err.statusCode === 401, 'status ' + (err && err.statusCode))
    assert(/invalid email or password/i.test(err.message), err.message)
  })

  await t('unknown email returns 401', async () => {
    const { err } = await run(authController.login, { email: 'nobody@live.rmutl.ac.th', password: VALID_PW })
    assert(err && err.statusCode === 401, 'status ' + (err && err.statusCode))
  })

  await t('no login path can answer 403 any more', async () => {
    const attempts = [
      { email: registration.email, password: 'WrongPass@1' },
      { email: 'nobody@live.rmutl.ac.th', password: VALID_PW },
    ]
    for (const body of attempts) {
      const { err } = await run(authController.login, body)
      assert(!err || err.statusCode !== 403, 'got a 403 for ' + body.email)
    }
  })

  console.log('\n== THE VERIFICATION SURFACE IS GONE ==')

  await t('verifyEmail / resendVerification are no longer exported', async () => {
    assert(authController.verifyEmail === undefined, 'verifyEmail still exported')
    assert(authController.resendVerification === undefined, 'resendVerification still exported')
  })

  await t('the mail and token modules are deleted', async () => {
    const gone = [
      '../src/services/email.service.js',
      '../src/services/verification.service.js',
      '../src/utils/verificationToken.js',
    ]
    for (const rel of gone) {
      assert(!fs.existsSync(path.join(__dirname, rel)), rel + ' still exists')
    }
  })

  await t('nodemailer is no longer a dependency', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    assert(!pkg.dependencies.nodemailer, 'nodemailer still in dependencies')
    assert(!(pkg.devDependencies || {}).nodemailer, 'nodemailer still in devDependencies')
  })

  await t('no SMTP config is exported from env', async () => {
    const env = require('../src/config/env')
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM']) {
      assert(!(key in env), key + ' is still exported')
    }
  })

  await t('Google OAuth config is still exported (must not regress)', async () => {
    const env = require('../src/config/env')
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']) {
      assert(key in env, key + ' went missing')
    }
  })

  console.log('\n== BACKWARD COMPATIBILITY (pre-existing accounts) ==')

  await t('legacy account without emailVerified can log in', async () => {
    // A document written before email verification existed.
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

  await t('account still flagged emailVerified:false can now log in', async () => {
    // The important migration case: an account left unverified by the old
    // flow is no longer locked out, without touching the database.
    store.push(
      new FakeUser({
        email: 'stuck@live.rmutl.ac.th',
        passwordHash: await bcrypt.hash(VALID_PW, 4),
        role: 'student',
        firstName: 'Stuck',
        emailVerified: false,
      })
    )
    const { res, err } = await run(authController.login, { email: 'stuck@live.rmutl.ac.th', password: VALID_PW })
    assert(!err, 'previously-unverified account is still blocked: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(res.cookies.token, 'no session cookie issued')
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
