// Covers "Remove Club Admin": the position must be revoked WITHOUT deleting
// the user account or any of their history, and all elevated access must stop
// immediately. Models are stubbed — no database needed.
// Run: node tests/removeClubAdmin.test.js
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
let deleteCalls = 0
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
  if (query.$or) return query.$or.some((c) => matches(u, c))
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
// Tracks any attempt to hard-delete an account — the whole point of this flow
// is that it must never happen.
FakeUser.deleteOne = async () => {
  deleteCalls += 1
  return { deletedCount: 1 }
}
require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }

require.cache[require.resolve('../src/models/Club')] = {
  exports: { countDocuments: async (q) => (q?._id?.$in ? q._id.$in.length : 0) },
}

// Membership / participation history must survive untouched.
const memberships = [{ _id: 'm1', student: null, club: 'c1' }]
const participations = [{ _id: 'p1', student: null, activity: 'a1', status: 'attended', hoursEarned: 6 }]
require.cache[require.resolve('../src/models/ClubMembership')] = {
  exports: {
    find: () => ({ populate: () => ({ sort: async () => memberships }) }),
    countDocuments: async () => memberships.length,
    deleteMany: async () => {
      throw new Error('history must never be deleted')
    },
  },
}
require.cache[require.resolve('../src/models/ActivityParticipation')] = {
  exports: {
    find: () => ({ populate: () => ({ populate: () => ({ sort: async () => participations }) }) }),
    countDocuments: async () => participations.length,
    deleteMany: async () => {
      throw new Error('history must never be deleted')
    },
  },
}

const adminUserController = require('../src/controllers/adminUser.controller')
const authController = require('../src/controllers/auth.controller')
const authorize = require('../src/middleware/authorize')
const { assertManagesClub } = require('../src/utils/clubAccess')
const { hasSuperadminPowers } = require('../src/utils/adminAccess')

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
const CLUB_A = '507f1f77bcf86cd799439011'
const CLUB_B = '507f1f77bcf86cd799439012'

// The superadmin needs to exist for the DB-backed role resolution.
store.push(new FakeUser({ _id: 'root', role: 'superadmin', email: 'root@x.co' }))

const makeClubAdmin = async (n, clubs = [CLUB_A]) => {
  await run(adminUserController.createClubAdmin, {
    user: superadmin,
    body: {
      studentId: 'ca-' + n,
      firstName: 'Admin',
      lastName: String(n),
      email: `remove${n}@live.rmutl.ac.th`,
      password: STRONG_PW,
      managedClubs: clubs,
    },
  })
  const account = store.find((u) => u.email === `remove${n}@live.rmutl.ac.th`)
  account.totalVolunteerHours = 12 // pre-existing history to protect
  return account
}

const main = async () => {
  console.log('\n== REMOVAL REVOKES THE POSITION, KEEPS THE ACCOUNT ==')

  const admin = await makeClubAdmin(1, [CLUB_A, CLUB_B])
  const adminId = admin._id

  await t('removal succeeds', async () => {
    const { res, err } = await run(adminUserController.removeClubAdmin, {
      user: superadmin,
      params: { id: adminId },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200, 'status ' + res.statusCode)
    assert(/remains active as a student/i.test(res.body.message), res.body.message)
  })

  await t('the User document is NOT deleted', async () => {
    assert(deleteCalls === 0, 'User.deleteOne was called ' + deleteCalls + ' time(s)')
    assert(store.some((u) => String(u._id) === String(adminId)), 'account disappeared from users')
  })

  await t('role is changed club_admin -> student', async () => {
    assert(admin.role === 'student', 'role = ' + admin.role)
  })

  await t('managedClubs is cleared', async () => {
    assert(Array.isArray(admin.managedClubs) && admin.managedClubs.length === 0, JSON.stringify(admin.managedClubs))
  })

  await t('account identity and credentials are preserved', async () => {
    assert(admin.email === 'remove1@live.rmutl.ac.th', 'email lost')
    assert(admin.studentId === 'ca-1', 'studentId lost')
    assert(typeof admin.passwordHash === 'string' && admin.passwordHash.length > 0, 'password lost')
    assert(admin.emailVerified === true, 'email verification lost')
  })

  await t('volunteer-hour and history data is untouched', async () => {
    assert(admin.totalVolunteerHours === 12, 'hours = ' + admin.totalVolunteerHours)
    const ClubMembership = require('../src/models/ClubMembership')
    const ActivityParticipation = require('../src/models/ActivityParticipation')
    assert((await ClubMembership.countDocuments()) === 1, 'membership history changed')
    assert((await ActivityParticipation.countDocuments()) === 1, 'participation history changed')
  })

  await t('the removed account can still log in (as a student)', async () => {
    const { res, err } = await run(authController.login, {
      body: { email: admin.email, password: STRONG_PW },
    })
    assert(!err, 'login blocked: ' + (err && err.message))
    assert(res.statusCode === 200 && res.cookies.token, 'no session issued')
    assert(res.body.data.user.role === 'student', 'role in session = ' + res.body.data.user.role)
  })

  console.log('\n== AUTHORIZATION STOPS IMMEDIATELY (even with a stale token) ==')

  // A cookie minted before removal still claims club_admin.
  const staleToken = { id: adminId, role: 'club_admin' }

  await t('stale club_admin token no longer passes authorize("club_admin")', async () => {
    const { err } = await run(authorize('superadmin', 'club_admin'), { user: { ...staleToken } })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('stale token no longer passes authorize("superadmin")', async () => {
    const { err } = await run(authorize('superadmin'), { user: { ...staleToken } })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('removed admin can no longer manage their former clubs', async () => {
    for (const club of [CLUB_A, CLUB_B]) {
      let denied = false
      try {
        await assertManagesClub({ id: adminId, role: 'club_admin' }, club)
      } catch (e) {
        denied = e.statusCode === 403
      }
      assert(denied, 'still had access to ' + club)
    }
  })

  await t('the account regains its student routes at once', async () => {
    const { err } = await run(authorize('student'), { user: { ...staleToken } })
    assert(!err, 'student route denied: ' + (err && err.message))
  })

  console.log('\n== REMOVING AN ELEVATED ADMIN FREES THE SLOT ==')

  const elevated = await makeClubAdmin(2)
  await t('set up: promote (active immediately)', async () => {
    await run(adminUserController.elevateClubAdmin, { user: superadmin, params: { id: elevated._id } })
    assert(elevated.elevatedAdmin === true, 'not elevated')
    assert((await hasSuperadminPowers({ id: elevated._id, role: 'club_admin' })) === true)
  })

  await t('removing them clears elevatedAdmin and its timestamp', async () => {
    const { err } = await run(adminUserController.removeClubAdmin, {
      user: superadmin,
      params: { id: elevated._id },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(elevated.elevatedAdmin !== true, 'still elevated')
    assert(elevated.elevatedAdminGrantedAt === null, 'grant timestamp kept')
    assert(elevated.role === 'student', 'role = ' + elevated.role)
  })

  await t('elevated powers are gone immediately', async () => {
    assert((await hasSuperadminPowers({ id: elevated._id, role: 'club_admin' })) === false)
    const { err } = await run(authorize('superadmin'), { user: { id: elevated._id, role: 'club_admin' } })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('the freed slot is immediately usable by someone else', async () => {
    const a = await makeClubAdmin(3)
    const b = await makeClubAdmin(4)
    for (const target of [a, b]) {
      const { err } = await run(adminUserController.elevateClubAdmin, {
        user: superadmin,
        params: { id: target._id },
      })
      assert(!err, 'promotion failed: ' + (err && err.message))
      assert(target.elevatedAdmin === true, target.email + ' not activated')
    }
    // Cap still holds afterwards.
    const c = await makeClubAdmin(5)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: c._id },
    })
    assert(err && err.statusCode === 409, 'cap not enforced after removal')
  })

  console.log('\n== REMOVAL CLEARS A LEGACY PENDING FLAG ==')

  await t('removal clears elevatedAdminPending left by the retired flow', async () => {
    // Free a slot first so the assertions below are not confused by the cap.
    const holders = store.filter((u) => u.elevatedAdmin === true)
    await run(adminUserController.revokeClubAdminElevation, {
      user: superadmin,
      params: { id: holders[0]._id },
    })

    const legacy = await makeClubAdmin(6)
    legacy.elevatedAdminPending = true // as written by the retired email flow

    await run(adminUserController.removeClubAdmin, { user: superadmin, params: { id: legacy._id } })
    assert(legacy.elevatedAdminPending !== true, 'still pending after removal')
    assert(legacy.elevatedAdmin !== true, 'privilege granted')
    assert(legacy.role === 'student', 'role = ' + legacy.role)
    assert((await hasSuperadminPowers({ id: legacy._id, role: 'club_admin' })) === false)
  })

  await t('a slot is still available afterwards', async () => {
    const spare = await makeClubAdmin(7)
    const { err } = await run(adminUserController.elevateClubAdmin, {
      user: superadmin,
      params: { id: spare._id },
    })
    assert(!err, 'slot was not available: ' + (err && err.message))
  })

  console.log('\n== GUARDS ==')

  await t('removing a non-existent id returns 404', async () => {
    const { err } = await run(adminUserController.removeClubAdmin, {
      user: superadmin,
      params: { id: '507f1f77bcf86cd799439099' },
    })
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('an invalid id returns 400', async () => {
    const { err } = await run(adminUserController.removeClubAdmin, {
      user: superadmin,
      params: { id: 'not-an-id' },
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('an already-removed (student) account is not removable again', async () => {
    const { err } = await run(adminUserController.removeClubAdmin, {
      user: superadmin,
      params: { id: adminId },
    })
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('no hard delete happened anywhere in this suite', async () => {
    assert(deleteCalls === 0, 'User.deleteOne was called ' + deleteCalls + ' time(s)')
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
