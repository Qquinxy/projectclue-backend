// Exercises the Super Admin-equivalent appointment: the 2-person cap, the
// email-confirmation gate, revoke/re-promote, and the permission wiring.
// Models and the mail transport are stubbed, so no database or SMTP needed.
// Run: node tests/elevation.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

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
// Ids must be ObjectId-shaped: the controllers validate them with
// isValidObjectId before doing anything else.
let idCounter = 0
const nextId = () => {
  idCounter += 1
  return String(idCounter).padStart(24, '6')
}
class FakeUser {
  constructor(doc) {
    Object.assign(this, doc)
    this._id = doc._id || nextId()
  }
  async save() {
    if (!store.includes(this)) store.push(this)
    return this
  }
  toObject() {
    return { ...this }
  }
}
const matches = (u, query) => {
  if (query.$or) {
    return query.$or.some((c) => matches(u, c))
  }
  return Object.entries(query).every(([k, v]) => {
    if (k === '_id' && v && v.$ne) return String(u._id) !== String(v.$ne)
    if (k === '_id') return String(u._id) === String(v)
    return u[k] === v
  })
}
FakeUser.create = async (doc) => new FakeUser(doc).save()
FakeUser.findById = (id) => {
  const p = Promise.resolve(store.find((u) => String(u._id) === String(id)) || null)
  p.select = () => p
  return p
}
FakeUser.findOne = (query) => {
  const p = Promise.resolve(store.find((u) => matches(u, query)) || null)
  p.select = () => p
  return p
}
FakeUser.countDocuments = async (query) => store.filter((u) => matches(u, query)).length
FakeUser.find = (query) => {
  const p = Promise.resolve(store.filter((u) => matches(u, query)))
  p.sort = () => p
  return p
}
require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }

// --- stub the mail transport -------------------------------------------
const sent = []
let mailFailure = null
require.cache[require.resolve('../src/services/email.service')] = {
  exports: {
    isEmailConfigured: () => true,
    sendVerificationEmail: async ({ to, token }) => {
      if (mailFailure) throw mailFailure
      sent.push({ kind: 'verification', to, token })
    },
    sendElevationEmail: async ({ to, token }) => {
      if (mailFailure) throw mailFailure
      sent.push({ kind: 'elevation', to, token })
    },
  },
}

// Stubbed BEFORE the controllers are required, so they pick up the stub
// rather than the real (unconnected) Mongoose model.
require.cache[require.resolve('../src/models/Club')] = {
  exports: {
    countDocuments: async (query) => (query?._id?.$in ? query._id.$in.length : 0),
  },
}

const adminUserController = require('../src/controllers/adminUser.controller')
const authController = require('../src/controllers/auth.controller')
const authorize = require('../src/middleware/authorize')
const { assertManagesClub } = require('../src/utils/clubAccess')
const { hasSuperadminPowers } = require('../src/utils/adminAccess')

// --- express doubles ---------------------------------------------------
const mockRes = () => {
  const res = { statusCode: null, body: null, cookies: {} }
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (b) => ((res.body = b), res)
  res.cookie = (n, v) => ((res.cookies[n] = v), res)
  return res
}
const run = (handler, { params = {}, query = {}, user = null, body = {} } = {}) =>
  new Promise((resolve, reject) => {
    const res = mockRes()
    const originalJson = res.json
    res.json = (b) => {
      originalJson(b)
      resolve({ res, err: null })
      return res
    }
    handler({ params, query, user, body }, res, (e) => resolve({ res, err: e || null }))
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const superadmin = { id: 'root', role: 'superadmin' }
const STRONG_PW = 'ProjectClue@2026'

// authorize() resolves the caller's role from the database, so the accounts
// used in these assertions have to exist there (as they always do in
// production, where a JWT's `sub` is a real user id).
store.push(new FakeUser({ _id: 'root', role: 'superadmin', email: 'root@x.co' }))
store.push(new FakeUser({ _id: 's1', role: 'student', email: 'student@x.co' }))
const CLUB_A = '507f1f77bcf86cd799439011'
const CLUB_B = '507f1f77bcf86cd799439012'

const makeClubAdmin = async (n, extra = {}) => {
  const { res, err } = await run(adminUserController.createClubAdmin, {
    user: superadmin,
    body: {
      studentId: 'ca-' + n,
      firstName: 'Admin',
      lastName: String(n),
      email: `admin${n}@live.rmutl.ac.th`,
      password: STRONG_PW,
      managedClubs: [CLUB_A],
      ...extra,
    },
  })
  if (err) throw new Error('create failed: ' + err.message)
  const created = store.find((u) => u.email === `admin${n}@live.rmutl.ac.th`)
  return { created, res }
}

// Confirms an account's email the way the real flow does.
const verifyEmailOf = async (account) => {
  const token = sent.filter((s) => s.kind === 'verification' && s.to === account.email).pop().token
  const { err } = await run(authController.verifyEmail, { body: { token } })
  if (err) throw new Error('verify failed: ' + err.message)
}

const main = async () => {
  console.log('\n== CLUB ADMIN CREATION GOES THROUGH EMAIL VERIFICATION ==')

  let adminA
  await t('created club admin is unverified and gets a verification email', async () => {
    const { created, res } = await makeClubAdmin(1)
    adminA = created
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    assert(created.emailVerified === false, 'emailVerified=' + created.emailVerified)
    assert(res.body.data.verificationEmailSent === true)
    const mail = sent.filter((s) => s.kind === 'verification' && s.to === created.email)
    assert(mail.length === 1, 'emails sent: ' + mail.length)
    assert(/^[0-9a-f]{64}$/.test(mail[0].token), 'not a real token')
  })

  await t('created club admin cannot log in before verifying (no bypass)', async () => {
    const { err } = await run(authController.login, {
      body: { email: adminA.email, password: STRONG_PW },
    })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    assert(/verify your email/i.test(err.message), err.message)
  })

  await t('only the token hash is stored for the club admin', async () => {
    assert(adminA.emailVerificationTokenHash.length === 64)
    const raw = sent.find((s) => s.to === adminA.email).token
    assert(adminA.emailVerificationTokenHash !== raw, 'raw token was stored')
  })

  await t('club admin can log in after verifying', async () => {
    await verifyEmailOf(adminA)
    const { res, err } = await run(authController.login, {
      body: { email: adminA.email, password: STRONG_PW },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200 && res.cookies.token)
  })

  console.log('\n== ELEVATION REQUIRES EMAIL CONFIRMATION ==')

  await t('granting sends an appointment email and leaves it PENDING', async () => {
    const { res, err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: adminA._id },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(adminA.elevatedAdminPending === true, 'not pending')
    assert(adminA.elevatedAdmin !== true, 'privilege granted before confirmation')
    assert(sent.some((s) => s.kind === 'elevation' && s.to === adminA.email), 'no elevation email')
  })

  await t('PENDING elevation grants NO superadmin powers yet', async () => {
    const powers = await hasSuperadminPowers({ id: adminA._id, role: 'club_admin' })
    assert(powers === false, 'pending appointment already had powers')
  })

  await t('pending elevated admin is still blocked from superadmin-only routes', async () => {
    const { err } = await run(authorize('superadmin'), { user: { id: adminA._id, role: 'club_admin' } })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('confirming the appointment activates it', async () => {
    const token = sent.filter((s) => s.kind === 'elevation' && s.to === adminA.email).pop().token
    const { res, err } = await run(authController.verifyEmail, { body: { token } })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.body.data.kind === 'elevation', 'wrong kind: ' + res.body.data.kind)
    assert(adminA.elevatedAdmin === true, 'not activated')
    assert(adminA.elevatedAdminPending !== true, 'still pending')
  })

  await t('appointment token is single-use', async () => {
    assert(adminA.elevatedAdminTokenHash === null, 'token not cleared')
    const token = sent.filter((s) => s.kind === 'elevation' && s.to === adminA.email).pop().token
    const { err } = await run(authController.verifyEmail, { body: { token } })
    assert(err && err.statusCode === 400, 'reuse was accepted')
  })

  console.log('\n== ELEVATED ADMIN HAS SUPERADMIN-LEVEL PERMISSIONS ==')

  await t('elevated club_admin passes authorize("superadmin")', async () => {
    const { err } = await run(authorize('superadmin'), { user: { id: adminA._id, role: 'club_admin' } })
    assert(!err, 'was rejected: ' + (err && err.message))
  })

  await t('elevated club_admin may manage a club outside managedClubs', async () => {
    await assertManagesClub({ id: adminA._id, role: 'club_admin' }, CLUB_B)
  })

  await t('elevated club_admin still CANNOT grant/revoke elevation', async () => {
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: { id: adminA._id, role: 'club_admin' },
      params: { id: adminA._id },
    })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    assert(/Only a Super Admin/i.test(err.message), err.message)
  })

  console.log('\n== MAXIMUM 2 ELEVATED ADMINISTRATORS ==')

  let adminB
  let adminC
  await t('a second club admin can be elevated (2 of 2)', async () => {
    const { created } = await makeClubAdmin(2)
    adminB = created
    await verifyEmailOf(adminB)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: adminB._id },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    const token = sent.filter((s) => s.kind === 'elevation' && s.to === adminB.email).pop().token
    await run(authController.verifyEmail, { body: { token } })
    assert(adminB.elevatedAdmin === true)
  })

  await t('a THIRD promotion is rejected with 409 and a clear message', async () => {
    const { created } = await makeClubAdmin(3)
    adminC = created
    await verifyEmailOf(adminC)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: adminC._id },
    })
    assert(err, 'third promotion was allowed')
    assert(err.statusCode === 409, 'status ' + err.statusCode)
    assert(/maximum of 2/i.test(err.message), err.message)
    assert(adminC.elevatedAdminPending !== true, 'appointment was still created')
  })

  await t('the cap counts PENDING appointments too (no over-issue)', async () => {
    // Free a slot, hand it to C as a pending appointment, then try a 4th admin.
    await run(adminUserController.revokeClubAdminElevation, { user: superadmin, params: { id: adminB._id } })
    await run(adminUserController.elevateClubAdmin, { user: superadmin, params: { id: adminC._id } })
    assert(adminC.elevatedAdminPending === true, 'C not pending')

    const { created: adminD } = await makeClubAdmin(4)
    await verifyEmailOf(adminD)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: adminD._id },
    })
    assert(err && err.statusCode === 409, 'pending slot was not counted')
  })

  await t('cap is re-checked at activation time', async () => {
    // Re-elevate B so 2 slots are active while C still holds a pending token.
    await run(adminUserController.revokeClubAdminElevation, { user: superadmin, params: { id: adminC._id } })
    const cToken = sent.filter((s) => s.kind === 'elevation' && s.to === adminC.email).pop().token
    await run(adminUserController.elevateClubAdmin, { user: superadmin, params: { id: adminB._id } })
    const bToken = sent.filter((s) => s.kind === 'elevation' && s.to === adminB.email).pop().token
    await run(authController.verifyEmail, { body: { token: bToken } })
    assert(adminB.elevatedAdmin === true, 'B not active')

    // C's older token must not activate a third administrator.
    adminC.elevatedAdminTokenHash = require('../src/utils/verificationToken').hashToken(cToken)
    adminC.elevatedAdminExpires = new Date(Date.now() + 3600e3)
    const { err } = await run(authController.verifyEmail, { body: { token: cToken } })
    assert(err && err.statusCode === 409, 'activation bypassed the cap: ' + (err && err.statusCode))
    assert(adminC.elevatedAdmin !== true, 'third admin became active')
  })

  console.log('\n== REVOKE FREES A SLOT ==')

  await t('revoking removes the privilege but keeps the club_admin account', async () => {
    const { err } = await run(adminUserController.revokeClubAdminElevation, {
      user: superadmin,
      params: { id: adminA._id },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(adminA.elevatedAdmin !== true, 'still elevated')
    assert(adminA.role === 'club_admin', 'role changed')
    assert(adminA.managedClubs.includes(CLUB_A), 'managed clubs lost')
    assert(adminA.emailVerified === true, 'email verification lost')
  })

  await t('revoked admin loses superadmin powers immediately', async () => {
    assert((await hasSuperadminPowers({ id: adminA._id, role: 'club_admin' })) === false)
  })

  await t('another club admin can now be promoted into the freed slot', async () => {
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: adminC._id },
    })
    assert(!err, 'promotion after revoke failed: ' + (err && err.message))
    const token = sent.filter((s) => s.kind === 'elevation' && s.to === adminC.email).pop().token
    await run(authController.verifyEmail, { body: { token } })
    assert(adminC.elevatedAdmin === true, 'not activated')
  })

  console.log('\n== EXISTING BEHAVIOUR PRESERVED ==')

  await t('plain superadmin still has full powers', async () => {
    assert((await hasSuperadminPowers(superadmin)) === true)
    const { err } = await run(authorize('superadmin'), { user: superadmin })
    assert(!err, 'superadmin rejected')
    await assertManagesClub(superadmin, CLUB_B)
  })

  await t('non-elevated club_admin keeps normal multi-club scoping', async () => {
    const { created } = await makeClubAdmin(5, { managedClubs: [CLUB_A, CLUB_B] })
    await assertManagesClub({ id: created._id, role: 'club_admin' }, CLUB_A)
    await assertManagesClub({ id: created._id, role: 'club_admin' }, CLUB_B)
    let denied = false
    try {
      await assertManagesClub({ id: created._id, role: 'club_admin' }, '507f1f77bcf86cd799439099')
    } catch (e) {
      denied = e.statusCode === 403
    }
    assert(denied, 'unmanaged club was allowed')
  })

  await t('students are still rejected by authorize("superadmin")', async () => {
    const { err } = await run(authorize('superadmin'), { user: { id: 's1', role: 'student' } })
    assert(err && err.statusCode === 403)
  })

  await t('elevating a non-club_admin id is rejected', async () => {
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: '507f1f77bcf86cd799439077' },
    })
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('elevating an unverified club admin is rejected', async () => {
    const { created } = await makeClubAdmin(6)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: created._id },
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    assert(/not verified their email/i.test(err.message), err.message)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
