// Exercises the two new pieces from the profile-completion feature:
//   (1) the reference-data controller (faculties / years / majors CRUD +
//       the public list), and
//   (2) the joinClub profile-completeness guard.
// Models are stubbed, so it runs without a database. Run via npm test.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const mongoose = require('mongoose')

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

// --- in-memory ReferenceData stand-in ------------------------------------
let refStore = []
let refSeq = 0
class FakeReferenceData {
  constructor(doc) {
    Object.assign(this, doc)
    this._id = doc._id || String(++refSeq)
  }
  async save() {
    const dup = refStore.some(
      (i) => i.type === this.type && i.value === this.value && i._id !== this._id
    )
    if (dup) {
      const err = new Error('duplicate key')
      err.code = 11000
      throw err
    }
    if (!refStore.includes(this)) refStore.push(this)
    return this
  }
  toObject() {
    return { ...this }
  }
}
FakeReferenceData.find = (filter) => {
  const arr = refStore.filter((i) => !filter || !filter.type || i.type === filter.type)
  const p = Promise.resolve(arr)
  p.sort = () => p
  return p
}
FakeReferenceData.findById = (id) =>
  Promise.resolve(refStore.find((i) => i._id === id) || null)
FakeReferenceData.findByIdAndDelete = (id) => {
  const idx = refStore.findIndex((i) => i._id === id)
  if (idx < 0) return Promise.resolve(null)
  return Promise.resolve(refStore.splice(idx, 1)[0])
}
FakeReferenceData.create = async (doc) => {
  const item = new FakeReferenceData(doc)
  await item.save()
  return item
}

require.cache[require.resolve('../src/models/ReferenceData')] = { exports: FakeReferenceData }

const referenceController = require('../src/controllers/reference.controller')

// --- req/res/next doubles ------------------------------------------------
const mockRes = () => {
  const res = { statusCode: null, body: null }
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (b) => ((res.body = b), res)
  return res
}
const run = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = mockRes()
    const originalJson = res.json
    res.json = (b) => {
      originalJson(b)
      resolve({ res, err: null })
      return res
    }
    handler(
      { params: {}, query: {}, body: {}, ...(req || {}) },
      res,
      (e) => resolve({ res, err: e })
    )
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const main = async () => {
  console.log('\n== REFERENCE DATA: PUBLIC LIST ==')

  await t('empty store returns empty grouped response', async () => {
    const { res, err } = await run(referenceController.listReference, {})
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(Array.isArray(res.body.data.referenceData) && res.body.data.referenceData.length === 0)
    assert(res.body.data.types.includes('faculty'))
    assert(res.body.data.types.includes('year'))
    assert(res.body.data.types.includes('major'))
  })

  refStore.push(
    new FakeReferenceData({ type: 'faculty', value: 'คณะวิศวกรรมศาสตร์', sortOrder: 1 }),
    new FakeReferenceData({ type: 'year', value: '1', label: 'ปี 1', sortOrder: 1 }),
    new FakeReferenceData({ type: 'major', value: 'วิศวกรรมคอมพิวเตอร์', sortOrder: 1 })
  )

  await t('lists all types by default', async () => {
    const { res, err } = await run(referenceController.listReference, {})
    assert(!err)
    assert(res.body.data.referenceData.length === 3)
  })

  await t('filters by ?type=', async () => {
    const { res, err } = await run(referenceController.listReference, { query: { type: 'major' } })
    assert(!err)
    const majors = res.body.data.referenceData
    assert(majors.length === 1 && majors[0].value === 'วิศวกรรมคอมพิวเตอร์')
  })

  console.log('\n== REFERENCE DATA: ADMIN CRUD ==')

  await t('admin create adds an item and returns it', async () => {
    const { res, err } = await run(referenceController.createReference, {
      body: { type: 'faculty', value: 'คณะบริหารธุรกิจ', sortOrder: 2 },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 201)
    assert(res.body.data.referenceData.value === 'คณะบริหารธุรกิจ')
    assert(res.body.data.referenceData.label === 'คณะบริหารธุรกิจ')
    assert(refStore.length === 4)
  })

  await t('duplicate value for the same type is 409', async () => {
    const { err } = await run(referenceController.createReference, {
      body: { type: 'faculty', value: 'คณะวิศวกรรมศาสตร์' },
    })
    assert(err && err.statusCode === 409, 'status ' + (err && err.statusCode))
  })

  await t('invalid type is 400', async () => {
    const { err } = await run(referenceController.createReference, {
      body: { type: 'department', value: 'x' },
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('missing value is 400', async () => {
    const { err } = await run(referenceController.createReference, {
      body: { type: 'major', value: '  ' },
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('update renames label (value kept)', async () => {
    const item = refStore.find((i) => i.value === '1')
    const { res, err } = await run(referenceController.updateReference, {
      params: { id: item._id },
      body: { label: 'ปีที่ 1' },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.body.data.referenceData.label === 'ปีที่ 1')
  })

  await t('update to a duplicate value is 409', async () => {
    const item = refStore.find((i) => i.value === 'คณะวิศวกรรมศาสตร์')
    const { err } = await run(referenceController.updateReference, {
      params: { id: item._id },
      body: { value: 'คณะบริหารธุรกิจ' },
    })
    assert(err && err.code === undefined && err.statusCode === 409, 'status ' + (err && err.statusCode))
  })

  await t('update of a missing item is 404', async () => {
    const { err } = await run(referenceController.updateReference, {
      params: { id: 'nope' },
      body: { value: 'x' },
    })
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('delete removes the item', async () => {
    const before = refStore.length
    const item = refStore.find((i) => i.type === 'major')
    const { res, err } = await run(referenceController.deleteReference, {
      params: { id: item._id },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
    assert(refStore.length === before - 1)
  })

  await t('delete of a missing item is 404', async () => {
    const { err } = await run(referenceController.deleteReference, { params: { id: 'nope' } })
    assert(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  console.log('\n== JOIN CLUB: PROFILE COMPLETENESS GUARD ==')

  // --- stubs for joinClub ---
  let profileDoc = null
  let sessionStarted = false
  let commits = 0
  let aborts = 0
  let createdMemberships = []
  const FAKE_CLUB_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'

  class FakeUser { }
  FakeUser.findById = async () => profileDoc
  require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }

  class FakeClub {
    constructor(doc) {
      Object.assign(this, doc)
      this.memberCount = doc.memberCount ?? 0
    }
    async save() {
      return this
    }
  }
  FakeClub.findById = () => {
    const club = new FakeClub({ memberCount: 0, maxMembers: 50 })
    const p = Promise.resolve(club)
    p.session = () => p
    return p
  }
  require.cache[require.resolve('../src/models/Club')] = { exports: FakeClub }

  class FakeMembership { }
  FakeMembership.findOne = () => {
    const p = Promise.resolve(null)
    p.session = () => p
    return p
  }
  FakeMembership.create = async (docs) => {
    createdMemberships.push(...docs)
    return docs
  }
  require.cache[require.resolve('../src/models/ClubMembership')] = { exports: FakeMembership }

  mongoose.startSession = async () => {
    sessionStarted = true
    return {
      startTransaction() {},
      async commitTransaction() {
        commits += 1
      },
      async abortTransaction() {
        aborts += 1
      },
      endSession() {},
    }
  }

  const membershipController = require('../src/controllers/membership.controller')

  await t('an incomplete profile is rejected with a clear 400', async () => {
    profileDoc = {
      _id: 'u1',
      phone: '',
      faculty: 'คณะวิศวกรรมศาสตร์',
      major: '',
      year: 1,
    }
    sessionStarted = false
    const { err } = await run(membershipController.joinClub, {
      params: { id: FAKE_CLUB_ID },
      user: { id: 'u1' },
    })
    assert(err, 'expected rejection')
    assert(err.statusCode === 400, 'status ' + err.statusCode)
    assert(/ข้อมูลส่วนตัว/.test(err.message), err.message)
    assert(!sessionStarted, 'transaction must not start when blocked')
    assert(createdMemberships.length === 0, 'no membership may be created')
  })

  await t('a Google-created user (empty phone/faculty/major) is blocked', async () => {
    profileDoc = { _id: 'u2', phone: '', faculty: '', major: '', year: 1 }
    const { err } = await run(membershipController.joinClub, {
      params: { id: FAKE_CLUB_ID },
      user: { id: 'u2' },
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('a complete profile proceeds to create the membership', async () => {
    profileDoc = {
      _id: 'u3',
      phone: '0812345678',
      faculty: 'คณะวิศวกรรมศาสตร์',
      major: 'วิศวกรรมคอมพิวเตอร์',
      year: 2,
    }
    sessionStarted = false
    commits = 0
    createdMemberships = []
    const { res, err } = await run(membershipController.joinClub, {
      params: { id: FAKE_CLUB_ID },
      user: { id: 'u3' },
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 201, 'status ' + res.statusCode)
    assert(createdMemberships.length === 1, 'membership not created')
    assert(createdMemberships[0].student === 'u3')
    assert(sessionStarted, 'transaction should run')
    assert(commits === 1, 'transaction not committed')
  })

  await t('isProfileComplete mirrors the backend rule', async () => {
    const cp = membershipController.isProfileComplete
    assert(cp({ phone: '', faculty: 'x', major: 'y', year: 1 }) === false)
    assert(cp({ phone: '08', faculty: '', major: 'y', year: 1 }) === false)
    assert(cp({ phone: '08', faculty: 'x', major: '', year: 1 }) === false)
    assert(cp({ phone: '08', faculty: 'x', major: 'y', year: 0 }) === false)
    assert(cp({ phone: '08', faculty: 'x', major: 'y', year: 2 }) === true)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})