// Covers Activity multi-image support:
//   - the schema serializer reports one `images` list, folding the legacy
//     single `image` in, so old activities keep their picture
//   - POST /activities/:id/images appends (never replaces) and accepts many
//     files in one request
//   - DELETE /activities/:id/images removes exactly one image
//   - authorization: superadmin any, club_admin only their own clubs,
//     student blocked by the route's authorize()
//   - multer is configured for 10MB PER FILE, JPEG/PNG/WEBP only
//   - a rejected upload leaves no orphaned file on disk
//   - the file remover refuses to escape uploads/activities
// Models are stubbed; no database, no production data touched.
// Run: node tests/activityImages.test.js
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const fs = require('fs')
const path = require('path')

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
const ACT_A = '607f1f77bcf86cd799439001' // club A, two images
const ACT_LEGACY = '607f1f77bcf86cd799439002' // club A, legacy single `image`
const ACT_OTHER = '607f1f77bcf86cd799439003' // club B — admin A must not touch it

// ---- users (for assertManagesClub) ----
const users = {
  adminA: { _id: 'adminA', role: 'club_admin', managedClubs: [CLUB_A] },
  // authorize() resolves the role from the database, not from the JWT claim.
  stu1: { _id: 'stu1', role: 'student', managedClubs: [] },
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

// ---- the real Activity model, used only for its schema serializer ----
const RealActivity = require('../src/models/Activity')

// ---- stubbed Activity documents ----
let saved = []
const makeDoc = (base) => ({
  ...base,
  save: async function () {
    saved.push({ id: String(this._id), images: [...(this.images || [])], image: this.image })
  },
})
let activities = {}
const resetActivities = () => {
  saved = []
  activities = {
    [ACT_A]: makeDoc({
      _id: ACT_A,
      club: CLUB_A,
      images: ['/uploads/activities/1.jpg', '/uploads/activities/2.jpg'],
      image: '/uploads/activities/1.jpg',
    }),
    [ACT_LEGACY]: makeDoc({
      _id: ACT_LEGACY,
      club: CLUB_A,
      images: [],
      image: '/uploads/activities/old.jpg',
    }),
    [ACT_OTHER]: makeDoc({
      _id: ACT_OTHER,
      club: CLUB_B,
      images: ['/uploads/activities/9.jpg'],
      image: '/uploads/activities/9.jpg',
    }),
  }
}
resetActivities()

require.cache[require.resolve('../src/models/Activity')] = {
  exports: {
    findById: (id) => {
      const p = Promise.resolve(activities[id] || null)
      p.populate = () => p
      return p
    },
    deleteOne: async () => ({ deletedCount: 1 }),
    countDocuments: async () => 0,
    create: async (doc) => doc,
    resolveImages: RealActivity.resolveImages,
    TYPES: RealActivity.TYPES,
    STATUSES: RealActivity.STATUSES,
  },
}
require.cache[require.resolve('../src/models/ActivityParticipation')] = {
  exports: { countDocuments: async () => 0 },
}
require.cache[require.resolve('../src/models/Club')] = {
  exports: { findById: async () => null, countDocuments: async () => 0, CATEGORIES: [] },
}
require.cache[require.resolve('../src/models/ClubMembership')] = {
  exports: { countDocuments: async () => 0 },
}

const activityController = require('../src/controllers/activity.controller')
const authorize = require('../src/middleware/authorize')
const uploadModule = require('../src/middleware/upload')
const {
  removeActivityImageFile,
  sanitizeImageList,
  ACTIVITY_IMAGE_PREFIX,
} = require('../src/utils/activityImages')

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
    h(
      {
        params: o.params || {},
        query: o.query || {},
        user: o.user || null,
        body: o.body || {},
        files: o.files,
      },
      r,
      (e) => resolve({ res: r, err: e || null })
    )
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const superadmin = { id: 'root', role: 'superadmin' }
const adminA = { id: 'adminA', role: 'club_admin' }
const student = { id: 'stu1', role: 'student' }

// Writes a real file into uploads/activities so the orphan-cleanup assertions
// operate on the actual filesystem the controller uses.
const uploadPath = (filename) => path.join(uploadModule.ACTIVITY_IMAGE_DIR, filename)
const makeUploadedFile = (name) => {
  fs.mkdirSync(uploadModule.ACTIVITY_IMAGE_DIR, { recursive: true })
  const filename = '__test__' + name
  fs.writeFileSync(uploadPath(filename), 'x')
  return { filename }
}
const cleanupFiles = (files) => files.forEach((f) => fs.rmSync(uploadPath(f.filename), { force: true }))
const uploadedExists = (filename) => fs.existsSync(uploadPath(filename))

const main = async () => {
  console.log('\n== SCHEMA: ONE `images` LIST, OLD DATA INCLUDED ==')

  const serialize = (doc) => new RealActivity(doc).toJSON()
  const base = {
    club: CLUB_A,
    title: 'T',
    description: 'D',
    date: new Date(),
    startTime: '09:00',
    endTime: '10:00',
    maxParticipants: 10,
    type: 'event',
    createdBy: CLUB_A,
  }

  await t('legacy single `image` is reported as a one-element `images`', () => {
    const out = serialize({ ...base, image: '/uploads/activities/old.jpg' })
    A(Array.isArray(out.images) && out.images.length === 1, JSON.stringify(out.images))
    A(out.images[0] === '/uploads/activities/old.jpg', out.images[0])
  })

  await t('the cover is mirrored into `image` so old consumers keep working', () => {
    const out = serialize({ ...base, images: ['/a.jpg', '/b.png'] })
    A(out.image === '/a.jpg', 'cover was ' + out.image)
    A(out.images.length === 2, JSON.stringify(out.images))
  })

  await t('an activity with no images at all serializes to []', () => {
    const out = serialize(base)
    A(Array.isArray(out.images) && out.images.length === 0, JSON.stringify(out.images))
    A(out.image === '', 'image was ' + JSON.stringify(out.image))
  })

  await t('blank/whitespace entries never reach the client', () => {
    const out = serialize({ ...base, images: ['', '   ', '/real.webp'] })
    A(out.images.length === 1 && out.images[0] === '/real.webp', JSON.stringify(out.images))
  })

  await t('sanitizeImageList trims, drops blanks and de-duplicates in order', () => {
    const list = sanitizeImageList(['/a', ' /b ', '/a', '', 5], '/c')
    A(JSON.stringify(list) === JSON.stringify(['/a', '/b', '/c']), JSON.stringify(list))
  })

  console.log('\n== UPLOAD: MULTIPLE FILES, APPEND-ONLY ==')

  await t('three files in one request are all appended', async () => {
    resetActivities()
    const files = [makeUploadedFile('a.jpg'), makeUploadedFile('b.png'), makeUploadedFile('c.webp')]
    const { res, err } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: ACT_A },
      files,
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 201, 'status ' + res.statusCode)
    const images = res.body.data.activity.images
    A(images.length === 5, 'got ' + images.length + ': ' + JSON.stringify(images))
    A(images[0] === '/uploads/activities/1.jpg', 'existing image lost its position')
    A(images[4] === ACTIVITY_IMAGE_PREFIX + files[2].filename, images[4])
    cleanupFiles(files)
  })

  await t('adding images later appends to what is already there', async () => {
    resetActivities()
    const first = [makeUploadedFile('d1.jpg'), makeUploadedFile('d2.jpg')]
    await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: ACT_A },
      files: first,
    })
    const second = [makeUploadedFile('d3.jpg'), makeUploadedFile('d4.webp')]
    const { res } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: ACT_A },
      files: second,
    })
    const images = res.body.data.activity.images
    A(images.length === 6, 'got ' + images.length)
    A(images.includes(ACTIVITY_IMAGE_PREFIX + first[0].filename), 'first batch lost')
    A(images.includes(ACTIVITY_IMAGE_PREFIX + second[1].filename), 'second batch missing')
    cleanupFiles([...first, ...second])
  })

  await t('uploading onto a legacy activity keeps the old picture as cover', async () => {
    resetActivities()
    const files = [makeUploadedFile('e1.jpg')]
    const { res } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: ACT_LEGACY },
      files,
    })
    const images = res.body.data.activity.images
    A(images.length === 2, JSON.stringify(images))
    A(images[0] === '/uploads/activities/old.jpg', 'legacy image was lost: ' + images[0])
    cleanupFiles(files)
  })

  await t('a request with no files is a 400', async () => {
    resetActivities()
    const { err } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: ACT_A },
      files: [],
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    A(/at least one image/i.test(err.message), err.message)
  })

  await t('uploading to a missing activity is a 404', async () => {
    const files = [makeUploadedFile('f1.jpg')]
    const { err } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: '607f1f77bcf86cd799439099' },
      files,
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
    cleanupFiles(files)
  })

  await t('an invalid activity id is a 400', async () => {
    const files = [makeUploadedFile('f2.jpg')]
    const { err } = await run(activityController.uploadActivityImages, {
      user: superadmin,
      params: { id: 'not-an-id' },
      files,
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    cleanupFiles(files)
  })

  console.log('\n== UPLOAD: AUTHORIZATION ==')

  await t('club_admin may upload to an activity of a club they manage', async () => {
    resetActivities()
    const files = [makeUploadedFile('g1.jpg')]
    const { res, err } = await run(activityController.uploadActivityImages, {
      user: adminA,
      params: { id: ACT_A },
      files,
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 201, 'status ' + res.statusCode)
    cleanupFiles(files)
  })

  await t("club_admin uploading to ANOTHER club's activity is a 403", async () => {
    resetActivities()
    const files = [makeUploadedFile('g2.jpg')]
    const { err } = await run(activityController.uploadActivityImages, {
      user: adminA,
      params: { id: ACT_OTHER },
      files,
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    A(saved.length === 0, 'the activity was modified anyway')
    cleanupFiles(files)
  })

  await t('a rejected upload leaves no orphaned file on disk', async () => {
    resetActivities()
    const files = [makeUploadedFile('g3.jpg')]
    A(uploadedExists(files[0].filename), 'fixture file was not created')
    await run(activityController.uploadActivityImages, {
      user: adminA,
      params: { id: ACT_OTHER },
      files,
    })
    A(!uploadedExists(files[0].filename), 'the uploaded file survived a 403')
  })

  await t('a student is blocked by the route guard (403)', async () => {
    const req = { user: student }
    const err = await new Promise((resolve) => {
      authorize('superadmin', 'club_admin')(req, {}, (e) => resolve(e || null))
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  console.log('\n== DELETE ONE IMAGE ==')

  await t('deleting the middle image keeps the others, in order', async () => {
    resetActivities()
    activities[ACT_A].images = [
      '/uploads/activities/1.jpg',
      '/uploads/activities/2.jpg',
      '/uploads/activities/3.jpg',
    ]
    const { res, err } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_A },
      body: { image: '/uploads/activities/2.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    const images = res.body.data.activity.images
    const expected = ['/uploads/activities/1.jpg', '/uploads/activities/3.jpg']
    A(JSON.stringify(images) === JSON.stringify(expected), JSON.stringify(images))
  })

  await t('the image path may also arrive as a query parameter', async () => {
    resetActivities()
    const { res, err } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_A },
      query: { image: '/uploads/activities/1.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.body.data.activity.images.length === 1, JSON.stringify(res.body.data.activity.images))
  })

  await t('deleting the last image empties the gallery and clears the cover', async () => {
    resetActivities()
    activities[ACT_A].images = ['/uploads/activities/1.jpg']
    const { res } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_A },
      body: { image: '/uploads/activities/1.jpg' },
    })
    A(res.body.data.activity.images.length === 0, JSON.stringify(res.body.data.activity.images))
    A(res.body.data.activity.image === '', 'cover was ' + res.body.data.activity.image)
  })

  await t("a legacy activity's single image can be deleted by its stored path", async () => {
    resetActivities()
    const { res, err } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_LEGACY },
      body: { image: '/uploads/activities/old.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.body.data.activity.images.length === 0, JSON.stringify(res.body.data.activity.images))
  })

  await t('deleting an image the activity does not have is a 404', async () => {
    resetActivities()
    const { err } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_A },
      body: { image: '/uploads/activities/nope.jpg' },
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
    A(/image not found/i.test(err.message), err.message)
  })

  await t('a delete with no image path is a 400', async () => {
    resetActivities()
    const { err } = await run(activityController.deleteActivityImage, {
      user: superadmin,
      params: { id: ACT_A },
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  await t("club_admin deleting from ANOTHER club's activity is a 403", async () => {
    resetActivities()
    const { err } = await run(activityController.deleteActivityImage, {
      user: adminA,
      params: { id: ACT_OTHER },
      body: { image: '/uploads/activities/9.jpg' },
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    A(saved.length === 0, 'the activity was modified anyway')
  })

  console.log('\n== UPDATE NEVER ERASES THE GALLERY ==')

  await t('PATCH ignores `images` / `image` in the body', async () => {
    resetActivities()
    const { err } = await run(activityController.updateActivity, {
      user: superadmin,
      params: { id: ACT_A },
      body: { title: 'Renamed', images: [], image: '' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(saved.length === 1, 'save was not called')
    A(saved[0].images.length === 2, 'gallery changed to ' + JSON.stringify(saved[0].images))
  })

  console.log('\n== MULTER CONFIGURATION ==')

  await t('the per-file limit is 10MB (not a per-request total)', () => {
    A(
      uploadModule.ACTIVITY_IMAGE_MAX_BYTES === 10 * 1024 * 1024,
      String(uploadModule.ACTIVITY_IMAGE_MAX_BYTES)
    )
  })

  await t('5 x 8MB is under the limit; a single 10.1MB file is over it', () => {
    const eightMB = 8 * 1024 * 1024
    A([1, 2, 3, 4, 5].every(() => eightMB <= uploadModule.ACTIVITY_IMAGE_MAX_BYTES), '8MB rejected')
    A(Math.round(10.1 * 1024 * 1024) > uploadModule.ACTIVITY_IMAGE_MAX_BYTES, '10.1MB accepted')
  })

  await t('the busboy limit is MAX+1 so a file of exactly 10MB is accepted', () => {
    // busboy trips on `fileSize === fileSizeLimit`, not on ">", so handing it
    // a flat 10MB would reject a file that is exactly 10MB.
    A(
      uploadModule.ACTIVITY_IMAGE_BUSBOY_LIMIT === uploadModule.ACTIVITY_IMAGE_MAX_BYTES + 1,
      String(uploadModule.ACTIVITY_IMAGE_BUSBOY_LIMIT)
    )
  })

  await t('accepted MIME types are exactly JPEG, PNG and WEBP', () => {
    const types = Object.keys(uploadModule.ACTIVITY_IMAGE_MIME_TYPES).sort()
    const expected = ['image/jpeg', 'image/png', 'image/webp']
    A(JSON.stringify(types) === JSON.stringify(expected), JSON.stringify(types))
  })

  await t('pdf / exe / txt / gif are all rejected', () => {
    for (const type of ['application/pdf', 'application/x-msdownload', 'text/plain', 'image/gif']) {
      A(!uploadModule.ACTIVITY_IMAGE_MIME_TYPES[type], type + ' was accepted')
    }
  })

  console.log('\n== FILE REMOVAL IS SANDBOXED ==')

  await t('a path outside uploads/activities is never unlinked', async () => {
    const canary = path.join(uploadModule.ACTIVITY_IMAGE_DIR, '..', '__canary__.txt')
    fs.writeFileSync(canary, 'keep me')
    await removeActivityImageFile('/uploads/activities/../__canary__.txt')
    await removeActivityImageFile('/uploads/clubs/anything.jpg')
    await removeActivityImageFile('https://example.com/photo.jpg')
    A(fs.existsSync(canary), 'the canary file was deleted')
    fs.rmSync(canary, { force: true })
  })

  await t('a missing file is not an error', async () => {
    await removeActivityImageFile('/uploads/activities/definitely-not-here.jpg')
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
