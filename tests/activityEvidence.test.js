// Exercises private evidence processing and authorization without MongoDB.
// Run: node tests/activityEvidence.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const User = require('../src/models/User')
const ActivityParticipation = require('../src/models/ActivityParticipation')
const upload = require('../src/middleware/upload')
const evidenceFiles = require('../src/utils/activityEvidence')
const participationController = require('../src/controllers/participation.controller')

const STUDENT_ID = '507f1f77bcf86cd799439011'
const PARTICIPATION_ID = '607f1f77bcf86cd799439001'
const CLUB_A = '707f1f77bcf86cd799439001'
const CLUB_B = '707f1f77bcf86cd799439002'
const USERS = {
  adminA: { role: 'club_admin', managedClubs: [CLUB_A], elevatedAdmin: false },
  root: { role: 'superadmin', managedClubs: [] },
}

const invoke = (handler, req) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(body) { resolve({ body, res: this }); return this },
    sendFile(file, options, callback) {
      this.file = file
      this.headers = options.headers
      callback?.()
      resolve({ res: this })
    },
  }
  Promise.resolve(handler(req, res, (error) => error ? resolve({ error }) : resolve({ res }))).catch(reject)
})

async function main() {
  const originalFindOne = ActivityParticipation.findOne
  const originalFindById = ActivityParticipation.findById
  const originalUserFindById = User.findById
  let participation

  try {
    assert(!path.resolve(upload.ACTIVITY_EVIDENCE_DIR).startsWith(path.resolve('uploads') + path.sep),
      'evidence directory must not be under public uploads')

    const inputPath = path.join(upload.ACTIVITY_EVIDENCE_DIR, 'test-input.upload')
    const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#c03030' } })
      .jpeg().toBuffer()
    fs.writeFileSync(inputPath, jpeg)
    const savedEvidence = await evidenceFiles.processActivityEvidence({ path: inputPath })
    assert.equal(savedEvidence.contentType, 'image/jpeg')
    assert(!fs.existsSync(inputPath), 'temporary upload must be removed')
    const outputPath = await evidenceFiles.readActivityEvidence(savedEvidence)
    const verified = await sharp(outputPath).metadata()
    assert.equal(verified.format, 'jpeg')
    assert.equal(verified.width, 3)
    console.log('PASS valid image bytes are decoded, normalized, and stored outside public uploads')
    await evidenceFiles.removeActivityEvidence(savedEvidence.filename)

    const invalidPath = path.join(upload.ACTIVITY_EVIDENCE_DIR, 'spoofed.png.upload')
    fs.writeFileSync(invalidPath, Buffer.from('not an image'))
    await assert.rejects(evidenceFiles.processActivityEvidence({ path: invalidPath }), (error) => error.statusCode === 400)
    assert(!fs.existsSync(invalidPath), 'invalid temporary upload must be removed')
    console.log('PASS invalid image content is rejected even when the filename claims PNG')

    const realDocument = new ActivityParticipation({
      student: STUDENT_ID,
      activity: '607f1f77bcf86cd799439002',
      status: 'attended',
      hoursEarned: 3,
      evidence: savedEvidence,
    })
    const json = realDocument.toJSON()
    assert.equal(json.status, 'attended')
    assert.equal(json.hoursEarned, 3)
    assert(!json.evidence.filename, 'private storage filename must not be exposed by JSON')
    const oldDocument = new ActivityParticipation({ student: STUDENT_ID, activity: '607f1f77bcf86cd799439002' })
    assert.equal(oldDocument.status, 'registered')
    assert.equal(oldDocument.hoursEarned, 0)
    assert.equal(oldDocument.toJSON().evidence, undefined)
    console.log('PASS evidence is optional and serialization does not expose the private filename')

    let ownerQuery
    ActivityParticipation.findOne = (query) => {
      ownerQuery = query
      return Promise.resolve(participation)
    }
    participation = { _id: PARTICIPATION_ID, student: STUDENT_ID, status: 'registered', hoursEarned: 0, save: async function () {} }
    const ownerRequest = {
      params: { id: PARTICIPATION_ID }, user: { id: STUDENT_ID, role: 'student' },
    }
    let result = await invoke(participationController.loadOwnEvidenceParticipation, ownerRequest)
    assert.deepEqual(ownerQuery, { _id: PARTICIPATION_ID, student: STUDENT_ID })
    assert.equal(ownerRequest.evidenceParticipation?._id, PARTICIPATION_ID)
    console.log('PASS student ownership lookup is scoped by the authenticated user ID')

    participation = null
    result = await invoke(participationController.loadOwnEvidenceParticipation, {
      params: { id: PARTICIPATION_ID }, user: { id: 'other-student', role: 'student' },
    })
    assert.equal(result.error.statusCode, 404)
    console.log('PASS student cannot resolve another owner’s participation by ID')

    const managedParticipation = (club) => {
      const query = Promise.resolve({ _id: PARTICIPATION_ID, activity: { club } })
      query.populate = () => query
      return query
    }
    ActivityParticipation.findById = () => managedParticipation(CLUB_A)
    User.findById = (id) => ({ select: async () => USERS[id] || null })
    result = await invoke(participationController.loadManagedEvidenceParticipation, {
      params: { id: PARTICIPATION_ID }, user: { id: 'adminA', role: 'club_admin' },
    })
    assert(!result.error, result.error?.message)
    ActivityParticipation.findById = () => managedParticipation(CLUB_B)
    result = await invoke(participationController.loadManagedEvidenceParticipation, {
      params: { id: PARTICIPATION_ID }, user: { id: 'adminA', role: 'club_admin' },
    })
    assert.equal(result.error.statusCode, 403)
    ActivityParticipation.findById = () => managedParticipation(CLUB_B)
    result = await invoke(participationController.loadManagedEvidenceParticipation, {
      params: { id: PARTICIPATION_ID }, user: { id: 'root', role: 'superadmin' },
    })
    assert(!result.error, result.error?.message)
    console.log('PASS club admins are scoped to managed clubs and superadmins retain access')

    const uploadPath = path.join(upload.ACTIVITY_EVIDENCE_DIR, 'controller-input.upload')
    fs.writeFileSync(uploadPath, jpeg)
    participation = {
      _id: PARTICIPATION_ID,
      student: STUDENT_ID,
      status: 'attended',
      hoursEarned: 3,
      save: async function () {},
    }
    result = await invoke(participationController.uploadActivityEvidence, {
      evidenceParticipation: participation,
      file: { path: uploadPath },
    })
    assert.equal(result.res.statusCode, 201)
    assert.equal(participation.status, 'attended')
    assert.equal(participation.hoursEarned, 3)
    await evidenceFiles.removeActivityEvidence(participation.evidence.filename)
    console.log('PASS evidence upload leaves attendance status and earned hours unchanged')

    const students = require('../src/routes/student.routes')
    const admin = require('../src/routes/admin.routes')
    const studentRoute = (method) => students.stack.map((layer) => layer.route)
      .find((route) => route?.path === '/me/participations/:id/evidence' && route.methods[method])
    const adminRoute = (method) => admin.stack.map((layer) => layer.route)
      .find((route) => route?.path === '/participations/:id/evidence' && route.methods[method])
    assert(studentRoute('post')?.stack.length >= 4)
    assert(studentRoute('get')?.stack.length >= 3)
    assert(studentRoute('delete')?.stack.length >= 3)
    assert(adminRoute('get')?.stack.length >= 3)
    assert(!adminRoute('post') && !adminRoute('delete'))
    console.log('PASS evidence routes are private, student mutations are owner-scoped, admin access is read-only')
  } finally {
    ActivityParticipation.findOne = originalFindOne
    ActivityParticipation.findById = originalFindById
    User.findById = originalUserFindById
  }
}

main().catch((error) => {
  console.error('FAIL ' + error.message)
  process.exitCode = 1
})
