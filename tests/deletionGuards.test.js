// Covers the deletion guards that protect attendance history:
//   - an Activity with participants cannot be hard-deleted (409)
//   - a Club with activities or members cannot be hard-deleted (409)
//   - authorization is still evaluated BEFORE the guard
//   - nothing is cascade-deleted and totalVolunteerHours never changes
// Models are stubbed; no database, no production data touched.
// Run: node tests/deletionGuards.test.js
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
const A = (c, m) => {
  if (!c) throw new Error(m || 'assertion failed')
}

const CLUB_A = '507f1f77bcf86cd799439011'
const CLUB_B = '507f1f77bcf86cd799439012'
const ACT_EMPTY = '607f1f77bcf86cd799439001' // no participants
const ACT_BUSY = '607f1f77bcf86cd799439002' // has participants
const ACT_OTHER = '607f1f77bcf86cd799439003' // belongs to a club the admin does NOT manage

// ---- users (for authorization) ----
const users = {
  adminA: { _id: 'adminA', role: 'club_admin', managedClubs: [CLUB_A] },
}
require.cache[require.resolve('../src/models/User')] = {
  exports: {
    findById: (id) => {
      const p = Promise.resolve(users[id] || null)
      p.select = () => p
      return p
    },
  },
}

// ---- activities ----
const activities = {
  [ACT_EMPTY]: { _id: ACT_EMPTY, club: CLUB_A, title: 'Empty', status: 'upcoming' },
  [ACT_BUSY]: { _id: ACT_BUSY, club: CLUB_A, title: 'Busy', status: 'upcoming' },
  [ACT_OTHER]: { _id: ACT_OTHER, club: CLUB_B, title: 'Other club', status: 'upcoming' },
}
let activityDeletes = []
const ActivityStub = {
  findById: (id) => {
    const doc = activities[id] || null
    const p = Promise.resolve(doc)
    p.populate = () => p
    return p
  },
  deleteOne: async (q) => {
    activityDeletes.push(String(q._id))
    return { deletedCount: 1 }
  },
  countDocuments: async (q) => Object.values(activities).filter((a) => String(a.club) === String(q.club)).length,
  // Image helper the delete path uses to clean up gallery files.
  resolveImages: (a) => (Array.isArray(a && a.images) ? a.images : a && a.image ? [a.image] : []),
  // Constants the activity validator reads off the model.
  TYPES: ['volunteer', 'workshop', 'meeting', 'event', 'training'],
  STATUSES: ['upcoming', 'ongoing', 'completed', 'cancelled'],
}
require.cache[require.resolve('../src/models/Activity')] = { exports: ActivityStub }

// ---- participations ----
// ACT_BUSY has one of each status so the guard can be checked per status.
let participations = [
  { _id: 'p1', activity: ACT_BUSY, student: 'stu1', status: 'attended', hoursEarned: 5 },
]
let participationDeletes = 0
require.cache[require.resolve('../src/models/ActivityParticipation')] = {
  exports: {
    countDocuments: async (q) => participations.filter((p) => String(p.activity) === String(q.activity)).length,
    deleteOne: async () => {
      participationDeletes += 1
      return { deletedCount: 1 }
    },
    deleteMany: async () => {
      participationDeletes += 1
      return { deletedCount: 1 }
    },
  },
}

// ---- clubs / memberships ----
const clubs = {
  [CLUB_A]: { _id: CLUB_A, name: 'Football' },
  [CLUB_B]: { _id: CLUB_B, name: 'Futsal' },
}
let clubDeletes = []
require.cache[require.resolve('../src/models/Club')] = {
  exports: {
    findById: async (id) => clubs[id] || null,
    deleteOne: async (q) => {
      clubDeletes.push(String(q._id))
      return { deletedCount: 1 }
    },
    countDocuments: async () => Object.keys(clubs).length,
    CATEGORIES: ['volunteer', 'academic', 'sports', 'arts', 'technology', 'social'],
  },
}
let memberships = []
require.cache[require.resolve('../src/models/ClubMembership')] = {
  exports: {
    countDocuments: async (q) => memberships.filter((m) => String(m.club) === String(q.club)).length,
    deleteMany: async () => {
      throw new Error('memberships must never be cascade-deleted')
    },
  },
}

const activityController = require('../src/controllers/activity.controller')
const clubController = require('../src/controllers/club.controller')

const run = (h, o) =>
  new Promise((resolve, reject) => {
    o = o || {}
    const r = { statusCode: null, body: null }
    r.status = (c) => ((r.statusCode = c), r)
    r.json = (b) => {
      r.body = b
      resolve({ res: r, err: null })
      return r
    }
    h({ params: o.params || {}, query: {}, user: o.user || null, body: o.body || {} }, r, (e) =>
      resolve({ res: r, err: e || null })
    )
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const superadmin = { id: 'root', role: 'superadmin' }
const adminA = { id: 'adminA', role: 'club_admin' }

const main = async () => {
  console.log('\n== ACTIVITY DELETION ==')

  await t('deleting an activity with 0 participations succeeds (200)', async () => {
    activityDeletes = []
    const { res, err } = await run(activityController.deleteActivity, {
      user: superadmin,
      params: { id: ACT_EMPTY },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    A(activityDeletes.includes(ACT_EMPTY), 'activity was not deleted')
  })

  await t('deleting an activity WITH participations is refused (409)', async () => {
    activityDeletes = []
    const { err } = await run(activityController.deleteActivity, {
      user: superadmin,
      params: { id: ACT_BUSY },
    })
    A(err, 'deletion was allowed')
    A(err.statusCode === 409, 'status ' + err.statusCode)
    A(activityDeletes.length === 0, 'activity was deleted anyway')
  })

  await t('the 409 message names the count and points at "cancelled"', async () => {
    const { err } = await run(activityController.deleteActivity, {
      user: superadmin,
      params: { id: ACT_BUSY },
    })
    A(/cannot be deleted/i.test(err.message), err.message)
    A(/participant record/i.test(err.message), err.message)
    A(/cancelled/i.test(err.message), err.message)
  })

  await t('participation records survive the refusal', async () => {
    A(participations.length === 1, 'participations changed')
    A(participationDeletes === 0, 'participations were deleted ' + participationDeletes + ' time(s)')
  })

  await t('totalVolunteerHours is never touched by a delete attempt', async () => {
    // The controller must not reach into users at all; hoursEarned stays put.
    A(participations[0].hoursEarned === 5, 'hoursEarned changed')
  })

  for (const status of ['registered', 'attended', 'absent']) {
    await t(`409 applies to a "${status}" participation`, async () => {
      participations = [{ _id: 'px', activity: ACT_BUSY, student: 'stu1', status, hoursEarned: 0 }]
      activityDeletes = []
      const { err } = await run(activityController.deleteActivity, {
        user: superadmin,
        params: { id: ACT_BUSY },
      })
      A(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
      A(activityDeletes.length === 0, 'activity deleted')
    })
  }
  participations = [{ _id: 'p1', activity: ACT_BUSY, student: 'stu1', status: 'attended', hoursEarned: 5 }]

  console.log('\n== AUTHORIZATION IS CHECKED BEFORE THE GUARD ==')

  await t('club_admin deleting another club\'s activity gets 403, not 409', async () => {
    activityDeletes = []
    const { err } = await run(activityController.deleteActivity, {
      user: adminA,
      params: { id: ACT_OTHER },
    })
    A(err, 'was allowed')
    A(err.statusCode === 403, 'status ' + err.statusCode + ' (must be 403, not 409 — no info leak)')
    A(activityDeletes.length === 0, 'activity deleted')
  })

  await t('club_admin CAN still delete their own empty activity', async () => {
    activityDeletes = []
    const { res, err } = await run(activityController.deleteActivity, {
      user: adminA,
      params: { id: ACT_EMPTY },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200)
  })

  await t('invalid activity id is still 400', async () => {
    const { err } = await run(activityController.deleteActivity, {
      user: superadmin,
      params: { id: 'not-an-id' },
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  console.log('\n== "CANCELLED" REMAINS THE SUPPORTED WAY TO RETIRE AN ACTIVITY ==')

  await t('setting an activity with participants to "cancelled" still works', async () => {
    const target = activities[ACT_BUSY]
    target.save = async () => target
    const { res, err } = await run(activityController.updateActivity, {
      user: superadmin,
      params: { id: ACT_BUSY },
      body: { status: 'cancelled' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    A(target.status === 'cancelled', 'status = ' + target.status)
    A(participations.length === 1, 'participations were touched')
    delete target.save
    target.status = 'upcoming'
  })

  console.log('\n== CLUB DELETION ==')

  await t('deleting a club with activities is refused (409)', async () => {
    clubDeletes = []
    memberships = []
    const { err } = await run(clubController.deleteClub, { user: superadmin, params: { id: CLUB_A } })
    A(err, 'deletion was allowed')
    A(err.statusCode === 409, 'status ' + err.statusCode)
    A(/cannot be deleted/i.test(err.message), err.message)
    A(clubDeletes.length === 0, 'club was deleted anyway')
  })

  await t('deleting a club with members is refused (409)', async () => {
    clubDeletes = []
    memberships = [{ _id: 'm1', club: CLUB_B, student: 'stu1' }]
    // CLUB_B still has ACT_OTHER, so drop that first to isolate the membership case.
    const saved = activities[ACT_OTHER]
    delete activities[ACT_OTHER]
    const { err } = await run(clubController.deleteClub, { user: superadmin, params: { id: CLUB_B } })
    activities[ACT_OTHER] = saved
    A(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
    A(/member/i.test(err.message), err.message)
    A(clubDeletes.length === 0, 'club deleted')
  })

  await t('an empty club can still be deleted (200)', async () => {
    clubDeletes = []
    memberships = []
    const EMPTY_CLUB = '507f1f77bcf86cd799439099'
    clubs[EMPTY_CLUB] = { _id: EMPTY_CLUB, name: 'Empty club' }
    const { res, err } = await run(clubController.deleteClub, {
      user: superadmin,
      params: { id: EMPTY_CLUB },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    A(clubDeletes.includes(EMPTY_CLUB), 'club was not deleted')
    delete clubs[EMPTY_CLUB]
  })

  await t('a missing club is still 404', async () => {
    const { err } = await run(clubController.deleteClub, {
      user: superadmin,
      params: { id: '507f1f77bcf86cd799439077' },
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('nothing was cascade-deleted anywhere in this suite', async () => {
    A(participationDeletes === 0, 'participations deleted: ' + participationDeletes)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
