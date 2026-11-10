// Covers the authenticated self-service studentId update path without a database.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const assert = require('assert')
const records = new Map([
  ['google-user', {
    _id: 'google-user', studentId: 'GC-9461924831', googleId: 'google-sub',
    role: 'student', managedClubs: ['club-1'], phone: '',
    toObject() { return { ...this } },
  }],
  ['other-user', {
    _id: 'other-user', studentId: '67543206106-9', role: 'student',
    toObject() { return { ...this } },
  }],
])

class FakeUser {}
FakeUser.findById = async (id) => records.get(String(id)) || null
FakeUser.findOne = async ({ studentId }) => [...records.values()].find((u) => u.studentId === studentId) || null
FakeUser.findByIdAndUpdate = async (id, updates) => {
  const record = records.get(String(id))
  if (!record) return null
  Object.assign(record, updates)
  return record
}

require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }
const authController = require('../src/controllers/auth.controller')

const run = (body, authenticatedUserId = 'google-user') => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; resolve({ res: this, err: null }); return this },
  }
  authController.updateMe(
    { body, user: { id: authenticatedUserId } },
    res,
    (err) => resolve({ res, err }),
  )
})

const main = async () => {
  let pass = 0
  let fail = 0
  const test = async (name, fn) => {
    try { await fn(); pass++; console.log(`  PASS ${name}`) }
    catch (error) { fail++; console.error(`  FAIL ${name}: ${error.message}`) }
  }

  await test('generated Google ID remains until a replacement is submitted', async () => {
    const { res, err } = await run({ phone: '0812345678' })
    assert.ifError(err)
    assert.strictEqual(res.body.data.user.studentId, 'GC-9461924831')
    assert.strictEqual(records.get('google-user').phone, '0812345678')
  })

  await test('Google account can replace generated ID and retain auth/role data', async () => {
    const { res, err } = await run({ studentId: '67543206105-8' })
    assert.ifError(err)
    assert.strictEqual(res.body.data.user.studentId, '67543206105-8')
    assert.strictEqual(res.body.data.user.googleId, 'google-sub')
    assert.strictEqual(res.body.data.user.role, 'student')
    assert.deepStrictEqual(res.body.data.user.managedClubs, ['club-1'])
  })

  await test('invalid student ID format is rejected without changing the old ID', async () => {
    const oldId = records.get('google-user').studentId
    const { err } = await run({ studentId: '67543206105' })
    assert(err)
    assert.strictEqual(err.statusCode, 400)
    assert.strictEqual(records.get('google-user').studentId, oldId)
  })

  await test('duplicate student ID is rejected without changing either account', async () => {
    const { err } = await run({ studentId: '67543206106-9' })
    assert(err)
    assert.strictEqual(err.statusCode, 409)
    assert.strictEqual(records.get('google-user').studentId, '67543206105-8')
    assert.strictEqual(records.get('other-user').studentId, '67543206106-9')
  })

  await test('request can only update the authenticated account', async () => {
    const { res, err } = await run({ studentId: '67543206107-0', id: 'other-user' })
    assert.ifError(err)
    assert.strictEqual(records.get('google-user').studentId, '67543206107-0')
    assert.strictEqual(records.get('other-user').studentId, '67543206106-9')
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
