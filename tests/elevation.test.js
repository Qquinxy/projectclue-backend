// Exercises the Super Admin-equivalent appointment: the 2-person cap, direct
// activation, revoke/re-promote, and the permission wiring.
// Models are stubbed, so no database is needed. Email verification has been
// removed, so a grant from a root superadmin activates immediately.
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

const elevate = (id, user = superadmin) =>
  run(adminUserController.elevateClubAdmin, { user, params: { id } })
const revoke = (id, user = superadmin) =>
  run(adminUserController.revokeClubAdminElevation, { user, params: { id } })

const main = async () => {
  console.log('\n== CLUB ADMIN CREATION IS IMMEDIATE (no email verification) ==')

  let adminA
  await t('created club admin is already verified', async () => {
    const { created, res } = await makeClubAdmin(1)
    adminA = created
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    assert(created.emailVerified === true, 'emailVerified=' + created.emailVerified)
    assert(created.emailVerifiedAt instanceof Date, 'emailVerifiedAt not set')
  })

  await t('creation response carries no verification fields', async () => {
    const { created, res } = await makeClubAdmin(90)
    assert(res.body.data.verificationEmailSent === undefined, 'verificationEmailSent returned')
    assert(!/verif/i.test(res.body.message), 'message mentions verification: ' + res.body.message)
    assert(created.emailVerificationTokenHash === undefined, 'token hash written')
  })

  await t('created club admin can log in right away', async () => {
    const { res, err } = await run(authController.login, {
      body: { email: adminA.email, password: STRONG_PW },
    })
    assert(!err, 'login was blocked: ' + (err && err.message))
    assert(res.statusCode === 200 && res.cookies.token, 'no session issued')
  })

  console.log('\n== ELEVATION ACTIVATES IMMEDIATELY ==')

  await t('granting activates the privilege in the same request', async () => {
    const { res, err } = await elevate(adminA._id)
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(adminA.elevatedAdmin === true, 'not activated')
    assert(adminA.elevatedAdminGrantedAt instanceof Date, 'grant time not recorded')
    assert(adminA.elevatedAdminPending !== true, 'left in a pending state')
  })

  await t('response reports it as active, not pending', async () => {
    const { res } = await elevate(adminA._id).then(() => revoke(adminA._id)).then(() => elevate(adminA._id))
    assert(res.body.data.elevationPending === undefined, 'elevationPending still returned')
    assert(/active immediately/i.test(res.body.message), res.body.message)
  })

  await t('the elevated admin has superadmin powers at once', async () => {
    const powers = await hasSuperadminPowers({ id: adminA._id, role: 'club_admin' })
    assert(powers === true, 'powers not granted')
  })

  await t('re-elevating an already elevated admin is rejected with 409', async () => {
    const { err } = await elevate(adminA._id)
    assert(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
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
    const { err } = await elevate(adminA._id, { id: adminA._id, role: 'club_admin' })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    assert(/Only a Super Admin/i.test(err.message), err.message)
  })

  await t('elevated club_admin cannot revoke either', async () => {
    const { err } = await revoke(adminA._id, { id: adminA._id, role: 'club_admin' })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  console.log('\n== MAXIMUM 2 ELEVATED ADMINISTRATORS ==')

  let adminB
  let adminC
  await t('a second club admin can be elevated (2 of 2)', async () => {
    const { created } = await makeClubAdmin(2)
    adminB = created
    const { err } = await elevate(adminB._id)
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(adminB.elevatedAdmin === true)
  })

  await t('a THIRD promotion is rejected with 409 and a clear message', async () => {
    const { created } = await makeClubAdmin(3)
    adminC = created
    const { err } = await elevate(adminC._id)
    assert(err, 'third promotion was allowed')
    assert(err.statusCode === 409, 'status ' + err.statusCode)
    assert(/maximum of 2/i.test(err.message), err.message)
    assert(adminC.elevatedAdmin !== true, 'privilege was granted anyway')
  })

  await t('the cap counts exactly the active holders', async () => {
    const active = store.filter((u) => u.elevatedAdmin === true)
    assert(active.length === 2, 'active holders: ' + active.length)
  })

  console.log('\n== LEGACY PENDING RECORDS DO NOT HOLD A SLOT ==')

  await t('a legacy elevatedAdminPending record grants no powers', async () => {
    // A document left behind by the retired email-confirmation flow.
    const legacy = new FakeUser({
      role: 'club_admin',
      email: 'legacy-pending@live.rmutl.ac.th',
      managedClubs: [CLUB_A],
      elevatedAdminPending: true,
    })
    store.push(legacy)
    const powers = await hasSuperadminPowers({ id: legacy._id, role: 'club_admin' })
    assert(powers === false, 'a pending record granted powers')
    const { err } = await run(authorize('superadmin'), { user: { id: legacy._id, role: 'club_admin' } })
    assert(err && err.statusCode === 403, 'pending record passed authorize')
  })

  await t('a legacy pending record does not consume one of the 2 slots', async () => {
    // Free one active slot; the promotion must succeed even though a stale
    // pending record still exists in the store.
    await revoke(adminB._id)
    const { err } = await elevate(adminC._id)
    assert(!err, 'stale pending record blocked a free slot: ' + (err && err.message))
    assert(adminC.elevatedAdmin === true, 'not activated')
  })

  await t('a legacy pending record can still be cleared through revoke', async () => {
    const legacy = store.find((u) => u.email === 'legacy-pending@live.rmutl.ac.th')
    const { err } = await revoke(legacy._id)
    assert(!err, 'could not revoke a stale pending record: ' + (err && err.message))
    assert(legacy.elevatedAdminPending !== true, 'still pending')
  })

  console.log('\n== REVOKE FREES A SLOT ==')

  await t('revoking removes the privilege but keeps the club_admin account', async () => {
    const { err } = await revoke(adminA._id)
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(adminA.elevatedAdmin !== true, 'still elevated')
    assert(adminA.role === 'club_admin', 'role changed')
    assert(adminA.managedClubs.includes(CLUB_A), 'managed clubs lost')
    assert(adminA.emailVerified === true, 'emailVerified flag lost')
  })

  await t('revoked admin loses superadmin powers immediately', async () => {
    assert((await hasSuperadminPowers({ id: adminA._id, role: 'club_admin' })) === false)
  })

  await t('revoking an admin that holds nothing is rejected', async () => {
    const { err } = await revoke(adminA._id)
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('another club admin can be promoted into the freed slot', async () => {
    const { created } = await makeClubAdmin(4)
    const { err } = await elevate(created._id)
    assert(!err, 'promotion after revoke failed: ' + (err && err.message))
    assert(created.elevatedAdmin === true, 'not activated')
    await revoke(created._id) // leave a free slot for the tests below
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
    const { err } = await elevate('507f1f77bcf86cd799439077')
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('elevating with an invalid id is rejected', async () => {
    const { err } = await elevate('not-an-object-id')
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('an account flagged emailVerified:false can now be elevated', async () => {
    // The old flow refused these with a 400. Verification is gone, so the
    // only gates left are the role check, the cap and root-superadmin.
    const stuck = new FakeUser({
      role: 'club_admin',
      email: 'stuck-admin@live.rmutl.ac.th',
      managedClubs: [CLUB_A],
      emailVerified: false,
    })
    store.push(stuck)
    const { err } = await elevate(stuck._id)
    assert(!err, 'still blocked on email verification: ' + (err && err.message))
    assert(stuck.elevatedAdmin === true, 'not activated')
    await revoke(stuck._id)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
