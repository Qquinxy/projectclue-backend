// Regression test for the "กิจกรรมของฉัน" bug: a registered upcoming
// activity was counted as 0 because the page gated on the STORED
// Activity.status field, which the backend never recomputes against the
// current date. This reproduces the exact classification the page performs.
// Run: node tests/myActivities.test.js

let pass = 0
let fail = 0
const t = (name, fn) => {
  try {
    fn()
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

const daysFromNow = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

// --- the ORIGINAL (buggy) classification, gated on the stored activity status
const oldUpcoming = (participations) =>
  participations.filter((p) => p.status === 'registered' && p.activity?.status === 'upcoming')

// --- the SECOND attempt: date-based, but still required participation
// status "registered". This is what shipped and still showed 0 for a student
// whose future activity had already been marked attended by an admin.
const dateOnlyUpcoming = (participations) => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return participations.filter(
    (p) =>
      p.status === 'registered' &&
      p.activity?.status !== 'cancelled' &&
      new Date(p.activity.date) >= startOfToday
  )
}

// --- the CURRENT classification, mirroring app/dashboard/my-activities/page.tsx
const ACTIVE_PARTICIPATION = ['registered', 'attended']
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000
const ictDayKey = (value) => {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10)
}
const newUpcoming = (participations) => {
  const today = ictDayKey(new Date())
  const hasNotPassed = (v) => {
    const day = ictDayKey(v)
    return day !== null && today !== null && day >= today
  }
  return participations
    .filter(
      (p) =>
        ACTIVE_PARTICIPATION.includes(p.status) &&
        p.activity?.status !== 'cancelled' &&
        hasNotPassed(p.activity.date)
    )
    .sort((a, b) => new Date(a.activity.date) - new Date(b.activity.date))
}

const completed = (participations) => participations.filter((p) => p.status === 'attended')

// A student who registered for a future activity whose STORED status was
// left at something other than "upcoming" (the backend only ever sets it at
// creation or on a manual admin edit), plus one already-attended activity.
const participations = [
  {
    id: 'p1',
    status: 'registered',
    hoursEarned: 0,
    activity: { id: 'a1', title: 'ค่ายอาสาพัฒนาชุมชน', date: daysFromNow(10), status: 'ongoing' },
  },
  {
    id: 'p2',
    status: 'attended',
    hoursEarned: 3,
    activity: { id: 'a2', title: 'กิจกรรมที่ผ่านมา', date: daysFromNow(-20), status: 'completed' },
  },
]

console.log('\n== REGRESSION: registered upcoming activity was reported as 0 ==')

t('the OLD filter reproduces the bug (0 upcoming)', () => {
  assert(oldUpcoming(participations).length === 0, 'bug did not reproduce')
})

t('the NEW filter shows the registered upcoming activity', () => {
  const up = newUpcoming(participations)
  assert(up.length === 1, 'upcoming count = ' + up.length)
  assert(up[0].activity.title === 'ค่ายอาสาพัฒนาชุมชน')
})

t('"เข้าร่วมแล้ว" is unchanged (past/attended still works)', () => {
  assert(completed(participations).length === 1)
  assert(completed(participations)[0].activity.title === 'กิจกรรมที่ผ่านมา')
})

t('"ทั้งหมด" contains the registered activity', () => {
  assert(participations.length === 2)
  assert(participations.some((p) => p.activity.id === 'a1'))
})

console.log('\n== REGRESSION 2: production data — future activity already marked "attended" ==')

// Mirrors the real database on 2026-09-05: the student's only participation is
// on RMUTL FUSAL LEAGUE (2026-09-07, i.e. two days away) but an admin had
// already marked it attended, so the page showed กำลังจะมา 0 / เข้าร่วมแล้ว 1 /
// ทั้งหมด 1 — exactly what was reported from the live site.
const attendedFuture = [
  {
    id: 'real1',
    status: 'attended',
    hoursEarned: 2,
    activity: {
      id: 'rmutl-futsal',
      title: 'RMUTL FUSAL LEAGUE',
      date: daysFromNow(2),
      status: 'upcoming',
      startTime: '21:29',
      endTime: '18:29',
    },
  },
]

t('the SHIPPED date-only filter still reproduced the live bug (0)', () => {
  assert(dateOnlyUpcoming(attendedFuture).length === 0, 'bug did not reproduce')
})

t('the current filter shows the future activity in กำลังจะมา', () => {
  const up = newUpcoming(attendedFuture)
  assert(up.length === 1, 'upcoming count = ' + up.length)
  assert(up[0].activity.title === 'RMUTL FUSAL LEAGUE')
})

t('it still counts in เข้าร่วมแล้ว (attendance record preserved)', () => {
  assert(completed(attendedFuture).length === 1)
})

t('an attended PAST activity is not upcoming', () => {
  const up = newUpcoming([
    { id: 'x', status: 'attended', activity: { id: 'x', date: daysFromNow(-3), status: 'completed' } },
  ])
  assert(up.length === 0, 'past attended activity counted as upcoming')
})

t('an "absent" participation is never upcoming', () => {
  const up = newUpcoming([
    { id: 'x', status: 'absent', activity: { id: 'x', date: daysFromNow(5), status: 'upcoming' } },
  ])
  assert(up.length === 0, 'absent counted as upcoming')
})

t('a withdrawn ("cancelled") participation is never upcoming', () => {
  const up = newUpcoming([
    { id: 'x', status: 'cancelled', activity: { id: 'x', date: daysFromNow(5), status: 'upcoming' } },
  ])
  assert(up.length === 0, 'cancelled counted as upcoming')
})

console.log('\n== THAILAND TIMEZONE (UTC+7) ==')

// Dates are stored as UTC midnight; Thailand is UTC+7.
const ictToday = ictDayKey(new Date())
const utcMidnightOf = (dayKey) => `${dayKey}T00:00:00.000Z`

t("an activity dated TODAY (stored as UTC midnight) counts as upcoming in ICT", () => {
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: utcMidnightOf(ictToday), status: 'upcoming' } },
  ])
  assert(up.length === 1, "today's activity was excluded")
})

t('an activity dated YESTERDAY in ICT is excluded', () => {
  const y = new Date(new Date(ictToday + 'T00:00:00.000Z').getTime() - 86400000)
    .toISOString()
    .slice(0, 10)
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: utcMidnightOf(y), status: 'upcoming' } },
  ])
  assert(up.length === 0, 'yesterday counted as upcoming')
})

t('an activity dated TOMORROW in ICT is included', () => {
  const tm = new Date(new Date(ictToday + 'T00:00:00.000Z').getTime() + 86400000)
    .toISOString()
    .slice(0, 10)
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: utcMidnightOf(tm), status: 'upcoming' } },
  ])
  assert(up.length === 1, 'tomorrow was excluded')
})

t('classification does not depend on endTime being after startTime', () => {
  // Real data has endTime earlier than startTime (21:00 -> 05:00).
  const up = newUpcoming([
    {
      id: 'x',
      status: 'registered',
      activity: { id: 'x', date: daysFromNow(1), status: 'upcoming', startTime: '21:00', endTime: '05:00' },
    },
  ])
  assert(up.length === 1, 'inverted times broke classification')
})

console.log('\n== DELETED ACTIVITY (activity: null) MUST NOT CRASH ==')

// Reproduces the two real dangling rows: the Activity was hard-deleted before
// that was blocked, so populate() yields null. The participation — and the
// hours it earned — are still valid and must never be dropped or crash a page.
const dangling = [
  { _id: 'd1', id: 'd1', status: 'attended', hoursEarned: 5, attendedAt: '2026-08-20T13:56:30.995Z', activity: null },
  { _id: 'd2', id: 'd2', status: 'absent', hoursEarned: 0, attendedAt: null, activity: null },
]

// app/dashboard/my-activities/page.tsx guards with .filter(p => p.activity)
const myActivitiesReceived = (rows) => rows.filter((p) => p.activity)

t('My Activities filters out null-activity rows without throwing', () => {
  const received = myActivitiesReceived(dangling)
  assert(received.length === 0, 'kept ' + received.length)
  assert(newUpcoming(received).length === 0)
  assert(completed(received).length === 0)
})

t('My Activities still works when null and valid rows are mixed', () => {
  const mixed = dangling.concat([
    { id: 'ok', status: 'registered', activity: { id: 'ok', date: daysFromNow(3), status: 'upcoming' } },
  ])
  const received = myActivitiesReceived(mixed)
  assert(received.length === 1, 'kept ' + received.length)
  assert(newUpcoming(received).length === 1, 'valid row lost')
})

// app/dashboard/page.tsx normalizeParticipation — must return activity:null,
// not dereference it.
const normalizeParticipation = (p) => ({
  ...p,
  id: p.id ?? p._id ?? '',
  activity: p.activity ? { ...p.activity, id: p.activity.id ?? p.activity._id ?? '' } : null,
})

t('dashboard normalizeParticipation handles activity:null without throwing', () => {
  const out = dangling.map(normalizeParticipation)
  assert(out.length === 2, 'rows dropped')
  assert(out[0].activity === null, 'activity not null')
  assert(out[0].id === 'd1', 'id lost')
})

t('dashboard attendedCount still counts a deleted-activity attendance', () => {
  // The row is kept, so the student's attendance is not understated.
  const out = dangling.map(normalizeParticipation)
  assert(out.filter((p) => p.status === 'attended').length === 1)
})

// app/dashboard/volunteer-hours/page.tsx row rendering
const renderVolunteerRow = (record) => ({
  title: record.activity ? record.activity.title : 'กิจกรรมถูกลบแล้ว',
  clickable: Boolean(record.activity),
  club: record.activity?.club?.name ?? '-',
  hours: record.hoursEarned,
})

t('volunteer-hours renders "กิจกรรมถูกลบแล้ว" for a deleted activity', () => {
  const row = renderVolunteerRow(dangling[0])
  assert(row.title === 'กิจกรรมถูกลบแล้ว', 'title = ' + row.title)
  assert(row.clickable === false, 'placeholder must not link anywhere')
  assert(row.club === '-', 'club = ' + row.club)
})

t('volunteer-hours preserves the earned hours on a deleted activity', () => {
  assert(renderVolunteerRow(dangling[0]).hours === 5, 'hours lost')
})

t('volunteer-hours still renders a normal row correctly', () => {
  const row = renderVolunteerRow({
    hoursEarned: 3,
    activity: { _id: 'a1', title: 'RMUTL FUSAL LEAGUE', club: { name: 'ฟุตซอล' } },
  })
  assert(row.title === 'RMUTL FUSAL LEAGUE')
  assert(row.clickable === true)
  assert(row.club === 'ฟุตซอล')
})

console.log('\n== DATE CLASSIFICATION EDGE CASES ==')

t('an activity happening TODAY counts as upcoming', () => {
  const today = new Date()
  today.setHours(23, 0, 0, 0)
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: today.toISOString(), status: 'upcoming' } },
  ])
  assert(up.length === 1, 'today was excluded')
})

t('a past registered activity is NOT upcoming', () => {
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: daysFromNow(-1), status: 'upcoming' } },
  ])
  assert(up.length === 0, 'past activity counted as upcoming')
})

t('a cancelled activity is excluded even when the date is future', () => {
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: daysFromNow(5), status: 'cancelled' } },
  ])
  assert(up.length === 0, 'cancelled activity counted as upcoming')
})

// NOTE: this assertion used to require that "attended" was never upcoming.
// That encoded the bug — an admin marking attendance early must not hide an
// activity that has not happened yet. Only the negative outcomes are excluded.
t('absent/cancelled are excluded, attended-but-future is kept', () => {
  const rows = ['absent', 'cancelled'].map((status, i) => ({
    id: 'x' + i,
    status,
    activity: { id: 'x' + i, date: daysFromNow(5), status: 'upcoming' },
  }))
  assert(newUpcoming(rows).length === 0, 'absent/cancelled counted as upcoming')

  const attended = [
    { id: 'a', status: 'attended', activity: { id: 'a', date: daysFromNow(5), status: 'upcoming' } },
  ]
  assert(newUpcoming(attended).length === 1, 'attended future activity was hidden')
})

t('upcoming list is sorted by nearest date first', () => {
  const up = newUpcoming([
    { id: 'far', status: 'registered', activity: { id: 'far', date: daysFromNow(30), status: 'upcoming' } },
    { id: 'near', status: 'registered', activity: { id: 'near', date: daysFromNow(2), status: 'upcoming' } },
  ])
  assert(up[0].id === 'near', 'not sorted by nearest date')
})

t('an unparseable date is excluded rather than crashing', () => {
  const up = newUpcoming([
    { id: 'x', status: 'registered', activity: { id: 'x', date: 'not-a-date', status: 'upcoming' } },
  ])
  assert(up.length === 0)
})

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
