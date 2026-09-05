const XLSX = require('xlsx')
const Activity = require('../models/Activity')
const ActivityParticipation = require('../models/ActivityParticipation')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { isValidObjectId } = require('../validators/validate')
const { assertManagesClub } = require('../utils/clubAccess')

// Columns mirror the real schema only — every value below is read from an
// existing field on Activity / ActivityParticipation / User / Club.
const COLUMNS = [
  { header: 'รหัสนักศึกษา', key: 'studentId' },
  { header: 'ชื่อ', key: 'firstName' },
  { header: 'นามสกุล', key: 'lastName' },
  { header: 'อีเมล', key: 'email' },
  { header: 'ชมรม', key: 'clubName' },
  { header: 'กิจกรรม', key: 'activityTitle' },
  { header: 'วันที่จัดกิจกรรม', key: 'activityDate' },
  { header: 'เวลาเริ่ม', key: 'startTime' },
  { header: 'เวลาสิ้นสุด', key: 'endTime' },
  { header: 'สถานะการเข้าร่วม', key: 'status' },
  { header: 'ชั่วโมงจิตอาสาที่ได้รับ', key: 'hoursEarned' },
  { header: 'วันที่ลงทะเบียน', key: 'registeredAt' },
  { header: 'วันที่บันทึกการเข้าร่วม', key: 'attendedAt' },
  { header: 'ผู้บันทึก', key: 'markedByName' },
]

const STATUS_LABELS = {
  registered: 'ลงทะเบียนแล้ว',
  attended: 'เข้าร่วมแล้ว',
  absent: 'ไม่ได้เข้าร่วม',
  cancelled: 'ยกเลิก',
}

const formatDate = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  // ISO-style yyyy-mm-dd keeps Excel from re-interpreting the value oddly.
  return d.toISOString().slice(0, 10)
}

const formatDateTime = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`
}

const buildRows = (activity, participants) =>
  participants.map((p) => ({
    studentId: p.student?.studentId ?? '',
    firstName: p.student?.firstName ?? '',
    lastName: p.student?.lastName ?? '',
    email: p.student?.email ?? '',
    clubName: activity.club?.name ?? '',
    activityTitle: activity.title ?? '',
    activityDate: formatDate(activity.date),
    startTime: activity.startTime ?? '',
    endTime: activity.endTime ?? '',
    status: STATUS_LABELS[p.status] || p.status || '',
    hoursEarned: typeof p.hoursEarned === 'number' ? p.hoursEarned : 0,
    registeredAt: formatDateTime(p.registeredAt),
    attendedAt: formatDateTime(p.attendedAt),
    markedByName: p.markedBy ? `${p.markedBy.firstName ?? ''} ${p.markedBy.lastName ?? ''}`.trim() : '',
  }))

// RFC 4180 quoting: wrap in quotes and double any embedded quote.
const csvCell = (value) => {
  const str = value === null || value === undefined ? '' : String(value)
  return `"${str.replace(/"/g, '""')}"`
}

const buildCsv = (rows) => {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(',')
  const body = rows.map((row) => COLUMNS.map((c) => csvCell(row[c.key])).join(',')).join('\r\n')
  return `${header}\r\n${body}`
}

// Safe ASCII fallback for the Content-Disposition filename, with the real
// (possibly Thai) name supplied via RFC 5987 filename*.
const buildFilename = (activity, extension) => {
  const base = `participants-${activity.title || 'activity'}-${formatDate(activity.date)}`
  const asciiFallback = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return {
    ascii: `${asciiFallback}.${extension}`,
    utf8: encodeURIComponent(`${base}.${extension}`),
  }
}

// GET /api/activities/:id/participants/export?format=csv|xlsx
//
// Authorization is identical to viewing the participant list: the club that
// owns THIS activity (resolved from the database, never from the request) has
// to be one the caller manages. A club_admin who swaps in another club's
// activityId is rejected with 403 by assertManagesClub.
exports.exportActivityParticipants = catchAsync(async (req, res, next) => {
  const activityId = req.params.id
  if (!isValidObjectId(activityId)) return next(new AppError('Invalid activity id', 400))

  const format = (req.query.format || 'csv').toString().toLowerCase()
  if (!['csv', 'xlsx'].includes(format)) {
    return next(new AppError('format must be either csv or xlsx', 400))
  }

  const activity = await Activity.findById(activityId).populate('club', 'name')
  if (!activity) return next(new AppError('Activity not found', 404))

  await assertManagesClub(req.user, activity.club?._id || activity.club)

  const participants = await ActivityParticipation.find({ activity: activityId })
    .populate('student', 'studentId firstName lastName email')
    .populate('markedBy', 'firstName lastName')
    .sort({ registeredAt: 1 })

  // Nothing to export: answer with a normal JSON error instead of streaming
  // an empty file the user then has to open to discover it is useless.
  if (participants.length === 0) {
    return next(new AppError('There are no participants to export for this activity', 404))
  }

  const rows = buildRows(activity, participants)
  const filename = buildFilename(activity, format)
  const disposition = `attachment; filename="${filename.ascii}"; filename*=UTF-8''${filename.utf8}`

  if (format === 'csv') {
    // UTF-8 BOM so Microsoft Excel detects the encoding and renders Thai
    // characters correctly instead of mojibake.
    const csv = `\uFEFF${buildCsv(rows)}`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', disposition)
    return res.status(200).send(Buffer.from(csv, 'utf8'))
  }

  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => {
      const mapped = {}
      COLUMNS.forEach((c) => {
        mapped[c.header] = row[c.key]
      })
      return mapped
    }),
    { header: COLUMNS.map((c) => c.header) }
  )
  worksheet['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 4) }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Participants')

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', disposition)
  return res.status(200).send(buffer)
})
