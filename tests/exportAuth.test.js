// Exercises the real export controller and the club-scope authorization
// helper with the models stubbed, so it runs without a database.
// Run: node tests/exportAuth.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const XLSX = require('xlsx')

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

const FOOTBALL = '507f1f77bcf86cd799439011'
const FUTSAL = '507f1f77bcf86cd799439012'
const VOLLEYBALL = '507f1f77bcf86cd799439013'
const FOOTBALL_ACTIVITY = '607f1f77bcf86cd799439011'
const VOLLEYBALL_ACTIVITY = '607f1f77bcf86cd799439012'
const EMPTY_ACTIVITY = '607f1f77bcf86cd799439013'

// --- stub models -------------------------------------------------------
// Admin A manages Football + Futsal (multiple clubs). Admin B manages Volleyball.
const users = {
  adminA: { _id: 'adminA', role: 'club_admin', managedClubs: [FOOTBALL, FUTSAL] },
  adminB: { _id: 'adminB', role: 'club_admin', managedClubs: [VOLLEYBALL] },
}
const FakeUser = {
  findById: (id) => {
    const p = Promise.resolve(users[id] || null)
    p.select = () => p
    return p
  },
}
require.cache[require.resolve('../src/models/User')] = { exports: FakeUser }

const activities = {
  [FOOTBALL_ACTIVITY]: {
    _id: FOOTBALL_ACTIVITY,
    club: { _id: FOOTBALL, name: 'ชมรมฟุตบอล' },
    title: 'อบรมฟุตบอลเยาวชน',
    date: new Date('2026-02-14T00:00:00Z'),
    startTime: '09:00',
    endTime: '12:00',
  },
  [VOLLEYBALL_ACTIVITY]: {
    _id: VOLLEYBALL_ACTIVITY,
    club: { _id: VOLLEYBALL, name: 'ชมรมวอลเลย์บอล' },
    title: 'แข่งวอลเลย์บอล',
    date: new Date('2026-03-01T00:00:00Z'),
    startTime: '13:00',
    endTime: '16:00',
  },
  [EMPTY_ACTIVITY]: {
    _id: EMPTY_ACTIVITY,
    club: { _id: FOOTBALL, name: 'ชมรมฟุตบอล' },
    title: 'กิจกรรมที่ยังไม่มีคนสมัคร',
    date: new Date('2026-04-01T00:00:00Z'),
    startTime: '10:00',
    endTime: '11:00',
  },
}
const FakeActivity = {
  findById: (id) => {
    const p = Promise.resolve(activities[id] || null)
    p.populate = () => p
    return p
  },
}
require.cache[require.resolve('../src/models/Activity')] = { exports: FakeActivity }

const participationsByActivity = {
  [FOOTBALL_ACTIVITY]: [
    {
      status: 'attended',
      hoursEarned: 3,
      registeredAt: new Date('2026-01-10T03:00:00Z'),
      attendedAt: new Date('2026-02-14T04:00:00Z'),
      student: {
        studentId: '67543206105-8',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        email: 'somchai@live.rmutl.ac.th',
      },
      markedBy: { firstName: 'ผู้ดูแล', lastName: 'ชมรม' },
    },
    {
      status: 'registered',
      hoursEarned: 0,
      registeredAt: new Date('2026-01-11T03:00:00Z'),
      attendedAt: null,
      student: {
        studentId: '67543206106-9',
        firstName: 'สมหญิง',
        lastName: 'รักเรียน',
        email: 'somying@live.rmutl.ac.th',
      },
      markedBy: null,
    },
  ],
  [VOLLEYBALL_ACTIVITY]: [],
  [EMPTY_ACTIVITY]: [],
}
const FakeParticipation = {
  find: (q) => {
    const p = Promise.resolve(participationsByActivity[q.activity] || [])
    p.populate = () => p
    p.sort = () => p
    return p
  },
}
require.cache[require.resolve('../src/models/ActivityParticipation')] = { exports: FakeParticipation }

const exportController = require('../src/controllers/export.controller')

// --- express doubles ---------------------------------------------------
const mockRes = () => {
  const res = { statusCode: null, headers: {}, payload: null }
  res.status = (c) => ((res.statusCode = c), res)
  res.setHeader = (k, v) => ((res.headers[k.toLowerCase()] = v), res)
  res.send = (b) => ((res.payload = b), res)
  res.json = (b) => ((res.payload = b), res)
  return res
}
const run = (handler, { params, query, user }) =>
  new Promise((resolve, reject) => {
    const res = mockRes()
    const originalSend = res.send
    res.send = (b) => {
      originalSend(b)
      resolve({ res, err: null })
      return res
    }
    handler({ params, query, user, body: {} }, res, (e) => resolve({ res, err: e }))
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const adminA = { id: 'adminA', role: 'club_admin' }
const adminB = { id: 'adminB', role: 'club_admin' }
const superadmin = { id: 'super', role: 'superadmin' }

const main = async () => {
  console.log('\n== MULTI-CLUB AUTHORIZATION (Admin A manages Football + Futsal) ==')

  await t('Admin A CAN export their Football activity', async () => {
    const { res, err } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'csv' },
      user: adminA,
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200, 'status ' + res.statusCode)
  })

  await t('Admin A CANNOT export Volleyball activity (403)', async () => {
    const { err } = await run(exportController.exportActivityParticipants, {
      params: { id: VOLLEYBALL_ACTIVITY },
      query: { format: 'csv' },
      user: adminA,
    })
    assert(err, 'expected rejection')
    assert(err.statusCode === 403, 'status ' + err.statusCode)
  })

  await t('Admin B CANNOT export Football activity (403)', async () => {
    const { err } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'xlsx' },
      user: adminB,
    })
    assert(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('superadmin CAN export any activity', async () => {
    const { res, err } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'csv' },
      user: superadmin,
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(res.statusCode === 200)
  })

  await t('invalid activity id is rejected (400)', async () => {
    const { err } = await run(exportController.exportActivityParticipants, {
      params: { id: 'not-an-id' },
      query: { format: 'csv' },
      user: adminA,
    })
    assert(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t('unknown format is rejected (400)', async () => {
    const { err } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'pdf' },
      user: adminA,
    })
    assert(err && err.statusCode === 400)
  })

  console.log('\n== CSV OUTPUT ==')

  let csvText = ''
  await t('CSV downloads with UTF-8 BOM and correct headers', async () => {
    const { res } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'csv' },
      user: adminA,
    })
    csvText = res.payload.toString('utf8')
    assert(res.headers['content-type'] === 'text/csv; charset=utf-8', res.headers['content-type'])
    assert(csvText.charCodeAt(0) === 0xfeff, 'missing UTF-8 BOM (Excel would mangle Thai)')
    assert(csvText.includes('"รหัสนักศึกษา"'), 'missing student id header')
    assert(csvText.includes('"ชั่วโมงจิตอาสาที่ได้รับ"'), 'missing hours header')
  })

  await t('CSV preserves Thai participant data', async () => {
    assert(csvText.includes('สมชาย'), 'missing Thai first name')
    assert(csvText.includes('ใจดี'), 'missing Thai last name')
    assert(csvText.includes('ชมรมฟุตบอล'), 'missing Thai club name')
    assert(csvText.includes('เข้าร่วมแล้ว'), 'missing Thai status label')
  })

  await t('CSV contains one row per participant plus header', async () => {
    const lines = csvText.trim().split('\r\n')
    assert(lines.length === 3, 'lines ' + lines.length)
  })

  await t('CSV exposes real fields only (id/date/time/hours)', async () => {
    assert(csvText.includes('67543206105-8'), 'missing studentId value')
    assert(csvText.includes('2026-02-14'), 'missing activity date')
    assert(csvText.includes('"09:00"'), 'missing start time')
    assert(csvText.includes('"12:00"'), 'missing end time')
    assert(csvText.includes('"3"'), 'missing hoursEarned')
  })

  await t('Content-Disposition carries a UTF-8 filename', async () => {
    const { res } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'csv' },
      user: adminA,
    })
    const cd = res.headers['content-disposition']
    assert(/attachment;/.test(cd), cd)
    assert(/filename\*=UTF-8''/.test(cd), cd)
  })

  console.log('\n== XLSX OUTPUT ==')

  await t('XLSX is a real workbook Excel can open', async () => {
    const { res, err } = await run(exportController.exportActivityParticipants, {
      params: { id: FOOTBALL_ACTIVITY },
      query: { format: 'xlsx' },
      user: adminA,
    })
    assert(!err, 'unexpected error: ' + (err && err.message))
    assert(
      res.headers['content-type'] ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      res.headers['content-type']
    )
    // ZIP magic number — a real .xlsx container, not a renamed CSV.
    assert(res.payload[0] === 0x50 && res.payload[1] === 0x4b, 'not a zip/xlsx container')

    const wb = XLSX.read(res.payload, { type: 'buffer' })
    assert(wb.SheetNames.includes('Participants'), 'sheets: ' + wb.SheetNames.join(','))
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Participants)
    assert(rows.length === 2, 'rows ' + rows.length)
    assert(rows[0]['ชื่อ'] === 'สมชาย', 'Thai name lost: ' + rows[0]['ชื่อ'])
    assert(rows[0]['สถานะการเข้าร่วม'] === 'เข้าร่วมแล้ว', rows[0]['สถานะการเข้าร่วม'])
    assert(rows[0]['ชั่วโมงจิตอาสาที่ได้รับ'] === 3, 'hours: ' + rows[0]['ชั่วโมงจิตอาสาที่ได้รับ'])
    assert(rows[0]['ผู้บันทึก'] === 'ผู้ดูแล ชมรม', 'markedBy: ' + rows[0]['ผู้บันทึก'])
  })

  console.log('\n== EMPTY PARTICIPANT LIST ==')

  await t('empty activity returns a clear error, not an empty file', async () => {
    const { err } = await run(exportController.exportActivityParticipants, {
      params: { id: EMPTY_ACTIVITY },
      query: { format: 'csv' },
      user: adminA,
    })
    assert(err, 'expected an error instead of a file')
    assert(err.statusCode === 404, 'status ' + err.statusCode)
    assert(/no participants/i.test(err.message), err.message)
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
