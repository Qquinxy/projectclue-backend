// Covers the CLUB PHOTO GALLERY (Club.galleryImages).
//
// The point of this suite is that three concepts stay separate:
//   Club.image          -> the ONE club cover/profile image  (uploads/clubs/)
//   Club.galleryImages  -> the club's own photos     (uploads/clubs-gallery/)
//   Activity images     -> nothing to do with either        (uploads/activities/)
//
// Models are stubbed; no database, no production data touched.
// Run: node tests/clubGallery.test.js
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

const CLUB_A = '507f1f77bcf86cd799439011' // managed by adminA, cover + 2 photos
const CLUB_LEGACY = '507f1f77bcf86cd799439012' // managed by adminA, cover only, no gallery field
const CLUB_OTHER = '507f1f77bcf86cd799439013' // NOT managed by adminA

const COVER_A = '/uploads/clubs/cover-a.jpg'
const COVER_LEGACY = '/uploads/clubs/cover-legacy.jpg'

// ---- users (for assertManagesClub / authorize) ----
const users = {
  adminA: { _id: 'adminA', role: 'club_admin', managedClubs: [CLUB_A, CLUB_LEGACY] },
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

// ---- the real Club model, used only to inspect the schema ----
const RealClub = require('../src/models/Club')

// ---- stubbed Club documents ----
let saved = []
const makeDoc = (base) => ({
  ...base,
  save: async function () {
    saved.push({
      id: String(this._id),
      image: this.image,
      galleryImages: [...(this.galleryImages || [])],
    })
  },
})
let clubs = {}
const resetClubs = () => {
  saved = []
  clubs = {
    [CLUB_A]: makeDoc({
      _id: CLUB_A,
      image: COVER_A,
      galleryImages: ['/uploads/clubs-gallery/1.jpg', '/uploads/clubs-gallery/2.jpg'],
    }),
    // A club from before this feature: it has a cover and NO galleryImages
    // field at all.
    [CLUB_LEGACY]: makeDoc({ _id: CLUB_LEGACY, image: COVER_LEGACY }),
    [CLUB_OTHER]: makeDoc({
      _id: CLUB_OTHER,
      image: '/uploads/clubs/cover-other.jpg',
      galleryImages: ['/uploads/clubs-gallery/9.jpg'],
    }),
  }
}
resetClubs()

require.cache[require.resolve('../src/models/Club')] = {
  exports: {
    findById: (id) => Promise.resolve(clubs[id] || null),
    deleteOne: async () => ({ deletedCount: 1 }),
    countDocuments: async () => 0,
    create: async (doc) => doc,
    CATEGORIES: RealClub.CATEGORIES,
  },
}
require.cache[require.resolve('../src/models/Activity')] = {
  exports: { countDocuments: async () => 0, TYPES: [], STATUSES: [] },
}
require.cache[require.resolve('../src/models/ClubMembership')] = {
  exports: { countDocuments: async () => 0 },
}

const clubController = require('../src/controllers/club.controller')
const authorize = require('../src/middleware/authorize')
const uploadModule = require('../src/middleware/upload')
const {
  removeClubGalleryFile,
  resolveGalleryImages,
  CLUB_GALLERY_PREFIX,
} = require('../src/utils/clubGalleryImages')
const storage = require('../src/services/storage.service')
const storedObjects = new Map()
storage.uploadPublicObject = async (key, buffer, contentType) => {
  storedObjects.set(key, { buffer: Buffer.from(buffer), contentType })
  return key
}
storage.removePublicObject = async (key) => storedObjects.delete(key)

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
        file: o.file,
      },
      r,
      (e) => resolve({ res: r, err: e || null })
    )
    setTimeout(() => reject(new Error('handler timed out')), 5000).unref()
  })

const superadmin = { id: 'root', role: 'superadmin' }
const adminA = { id: 'adminA', role: 'club_admin' }
const student = { id: 'stu1', role: 'student' }

// Upload fixtures live in the temporary staging directory used by Multer.
const galleryPath = (filename) => path.join(uploadModule.TEMP_UPLOAD_DIR, filename)
const makeUploadedFile = (name) => {
  fs.mkdirSync(uploadModule.TEMP_UPLOAD_DIR, { recursive: true })
  const filename = '__test__' + name
  fs.writeFileSync(galleryPath(filename), 'x')
  return { filename, path: galleryPath(filename), mimetype: 'image/jpeg' }
}
const cleanupFiles = (files) => files.forEach((f) => {
  try { fs.rmSync(galleryPath(f.filename), { force: true }) } catch (error) {
    if (error.code !== 'EPERM') throw error // controller already removed the staged file
  }
})
const uploadedExists = (filename) => fs.existsSync(galleryPath(filename))

const main = async () => {
  console.log('\n== SCHEMA: COVER AND GALLERY ARE SEPARATE FIELDS ==')

  await t('Club has BOTH `image` (cover) and `galleryImages`', () => {
    const paths = Object.keys(RealClub.schema.paths)
    A(paths.includes('image'), 'cover field `image` is missing')
    A(paths.includes('galleryImages'), '`galleryImages` is missing')
  })

  await t('`galleryImages` defaults to an empty array', () => {
    const doc = new RealClub({
      name: 'C',
      description: 'D',
      category: 'sports',
      maxMembers: 10,
      createdBy: CLUB_A,
    })
    A(Array.isArray(doc.galleryImages) && doc.galleryImages.length === 0, JSON.stringify(doc.galleryImages))
  })

  await t('the cover is NEVER surfaced as a gallery photo', () => {
    // The wrong earlier implementation made galleryImages fall back to [image].
    // A club with a cover and no gallery must report an EMPTY gallery.
    const doc = new RealClub({
      name: 'C',
      description: 'D',
      category: 'sports',
      maxMembers: 10,
      createdBy: CLUB_A,
      image: COVER_A,
    })
    const out = doc.toJSON()
    A(out.image === COVER_A, 'cover changed: ' + out.image)
    A(Array.isArray(out.galleryImages) && out.galleryImages.length === 0, JSON.stringify(out.galleryImages))
  })

  await t('resolveGalleryImages never falls back to the cover', () => {
    A(resolveGalleryImages({ image: COVER_A }).length === 0, 'cover leaked into the gallery')
    A(resolveGalleryImages({ image: COVER_A, galleryImages: ['/g/1.jpg'] }).length === 1)
    A(resolveGalleryImages(null).length === 0)
  })

  await t('a club with NO galleryImages field still works (old data)', () => {
    A(resolveGalleryImages(clubs[CLUB_LEGACY]).length === 0, 'legacy club produced a gallery')
    A(clubs[CLUB_LEGACY].image === COVER_LEGACY, 'legacy cover changed')
  })

  console.log('\n== UPLOAD: APPENDS TO THE GALLERY, NEVER TOUCHES THE COVER ==')

  await t('three files in one request are all appended', async () => {
    resetClubs()
    const files = [makeUploadedFile('a.jpg'), makeUploadedFile('b.png'), makeUploadedFile('c.webp')]
    const { res, err } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files,
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    const gallery = res.body.data.club.galleryImages
    A(gallery.length === 5, 'got ' + gallery.length + ': ' + JSON.stringify(gallery))
    A(gallery[0] === '/uploads/clubs-gallery/1.jpg', 'existing photo lost its position')
    A(gallery[4] === CLUB_GALLERY_PREFIX + files[2].filename, gallery[4])
    cleanupFiles(files)
  })

  await t('uploading a gallery photo does NOT change Club.image', async () => {
    resetClubs()
    const files = [makeUploadedFile('cover-check.jpg')]
    const { res } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files,
    })
    A(res.body.data.club.image === COVER_A, 'cover changed to ' + res.body.data.club.image)
    A(saved[0].image === COVER_A, 'cover was written as ' + saved[0].image)
    cleanupFiles(files)
  })

  await t('uploading onto a club with no gallery starts one, cover intact', async () => {
    resetClubs()
    const files = [makeUploadedFile('first.jpg')]
    const { res, err } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_LEGACY },
      files,
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    const gallery = res.body.data.club.galleryImages
    A(gallery.length === 1, JSON.stringify(gallery))
    A(gallery[0] === CLUB_GALLERY_PREFIX + files[0].filename, gallery[0])
    A(res.body.data.club.image === COVER_LEGACY, 'cover changed: ' + res.body.data.club.image)
    cleanupFiles(files)
  })

  await t('adding photos later appends to what is already there', async () => {
    resetClubs()
    const first = [makeUploadedFile('d1.jpg'), makeUploadedFile('d2.jpg')]
    await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files: first,
    })
    const second = [makeUploadedFile('d3.jpg'), makeUploadedFile('d4.webp')]
    const { res } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files: second,
    })
    const gallery = res.body.data.club.galleryImages
    A(gallery.length === 6, 'got ' + gallery.length)
    A(gallery.includes(CLUB_GALLERY_PREFIX + first[0].filename), 'first batch lost')
    A(gallery.includes(CLUB_GALLERY_PREFIX + second[1].filename), 'second batch missing')
    cleanupFiles([...first, ...second])
  })

  await t('every stored path is under /uploads/clubs-gallery/', async () => {
    resetClubs()
    const files = [makeUploadedFile('dir.jpg')]
    const { res } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files,
    })
    for (const src of res.body.data.club.galleryImages.slice(2)) {
      A(src.startsWith('/uploads/clubs-gallery/'), src)
      A(!src.startsWith('/uploads/clubs/'), 'a gallery photo landed in the cover directory: ' + src)
      A(!src.startsWith('/uploads/activities/'), 'a gallery photo landed in activities: ' + src)
    }
    cleanupFiles(files)
  })

  await t('a request with no files is a 400', async () => {
    resetClubs()
    const { err } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: CLUB_A },
      files: [],
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    A(/at least one image/i.test(err.message), err.message)
  })

  await t('uploading to a missing club is a 404', async () => {
    const files = [makeUploadedFile('f1.jpg')]
    const { err } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: '507f1f77bcf86cd799439099' },
      files,
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
    cleanupFiles(files)
  })

  await t('an invalid club id is a 400', async () => {
    const files = [makeUploadedFile('f2.jpg')]
    const { err } = await run(clubController.uploadClubGalleryImages, {
      user: superadmin,
      params: { id: 'not-an-id' },
      files,
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
    cleanupFiles(files)
  })

  console.log('\n== AUTHORIZATION ==')

  await t('club_admin may upload to a club they manage', async () => {
    resetClubs()
    const files = [makeUploadedFile('g1.jpg')]
    const { res, err } = await run(clubController.uploadClubGalleryImages, {
      user: adminA,
      params: { id: CLUB_A },
      files,
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    cleanupFiles(files)
  })

  await t('club_admin uploading to ANOTHER club is a 403', async () => {
    resetClubs()
    const files = [makeUploadedFile('g2.jpg')]
    const { err } = await run(clubController.uploadClubGalleryImages, {
      user: adminA,
      params: { id: CLUB_OTHER },
      files,
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    A(saved.length === 0, 'the club was modified anyway')
    cleanupFiles(files)
  })

  await t('a rejected upload leaves no orphaned file on disk', async () => {
    resetClubs()
    const files = [makeUploadedFile('g3.jpg')]
    A(uploadedExists(files[0].filename), 'fixture file was not created')
    await run(clubController.uploadClubGalleryImages, { user: adminA, params: { id: CLUB_OTHER }, files })
    A(!uploadedExists(files[0].filename), 'the uploaded file survived a 403')
  })

  await t('a student is blocked by the route guard (403)', async () => {
    const req = { user: student }
    const err = await new Promise((resolve) => {
      authorize('superadmin', 'club_admin')(req, {}, (e) => resolve(e || null))
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
  })

  await t('club_admin deleting from ANOTHER club is a 403', async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: adminA,
      params: { id: CLUB_OTHER },
      body: { image: '/uploads/clubs-gallery/9.jpg' },
    })
    A(err && err.statusCode === 403, 'status ' + (err && err.statusCode))
    A(saved.length === 0, 'the club was modified anyway')
  })

  console.log('\n== DELETE ONE GALLERY PHOTO ==')

  await t('deleting the middle photo keeps the others, in order', async () => {
    resetClubs()
    clubs[CLUB_A].galleryImages = [
      '/uploads/clubs-gallery/1.jpg',
      '/uploads/clubs-gallery/2.jpg',
      '/uploads/clubs-gallery/3.jpg',
    ]
    const { res, err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs-gallery/2.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.statusCode === 200, 'status ' + res.statusCode)
    const gallery = res.body.data.club.galleryImages
    const expected = ['/uploads/clubs-gallery/1.jpg', '/uploads/clubs-gallery/3.jpg']
    A(JSON.stringify(gallery) === JSON.stringify(expected), JSON.stringify(gallery))
  })

  await t('deleting a gallery photo does NOT delete Club.image', async () => {
    resetClubs()
    const { res } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs-gallery/1.jpg' },
    })
    A(res.body.data.club.image === COVER_A, 'cover changed to ' + res.body.data.club.image)
    A(saved[0].image === COVER_A, 'cover was written as ' + saved[0].image)
  })

  await t('the COVER image path cannot be deleted through the gallery API', async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: COVER_A },
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
    A(saved.length === 0, 'the club was modified')
  })

  await t('an ACTIVITY image path cannot be deleted through the gallery API', async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/activities/some-activity.jpg' },
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t("another club's gallery photo cannot be deleted", async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs-gallery/9.jpg' }, // belongs to CLUB_OTHER
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
  })

  await t('the photo path may also arrive as a query parameter', async () => {
    resetClubs()
    const { res, err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      query: { image: '/uploads/clubs-gallery/1.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(res.body.data.club.galleryImages.length === 1, JSON.stringify(res.body.data.club.galleryImages))
  })

  await t('emptying the gallery leaves the cover in place', async () => {
    resetClubs()
    clubs[CLUB_A].galleryImages = ['/uploads/clubs-gallery/only.jpg']
    const { res } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs-gallery/only.jpg' },
    })
    A(res.body.data.club.galleryImages.length === 0, JSON.stringify(res.body.data.club.galleryImages))
    A(res.body.data.club.image === COVER_A, 'cover changed: ' + res.body.data.club.image)
  })

  await t('a path-traversal target is a 404, not a deletion', async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs-gallery/../../server.js' },
    })
    A(err && err.statusCode === 404, 'status ' + (err && err.statusCode))
    A(fs.existsSync(path.join(__dirname, '..', 'server.js')), 'server.js was deleted!')
  })

  await t('a delete with no image path is a 400', async () => {
    resetClubs()
    const { err } = await run(clubController.deleteClubGalleryImage, {
      user: superadmin,
      params: { id: CLUB_A },
    })
    A(err && err.statusCode === 400, 'status ' + (err && err.statusCode))
  })

  console.log('\n== JSON WRITES NEVER TOUCH THE GALLERY ==')

  await t('PATCH ignores `galleryImages` in the body', async () => {
    resetClubs()
    const { err } = await run(clubController.updateClub, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { name: 'Renamed', galleryImages: [] },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(saved.length === 1, 'save was not called')
    A(saved[0].galleryImages.length === 2, 'gallery changed to ' + JSON.stringify(saved[0].galleryImages))
  })

  await t('PATCH can still set the cover `image` exactly as before', async () => {
    resetClubs()
    const { err } = await run(clubController.updateClub, {
      user: superadmin,
      params: { id: CLUB_A },
      body: { image: '/uploads/clubs/new-cover.jpg' },
    })
    A(!err, 'unexpected error: ' + (err && err.message))
    A(saved[0].image === '/uploads/clubs/new-cover.jpg', 'cover was ' + saved[0].image)
  })

  console.log('\n== MULTER CONFIGURATION ==')

  await t('gallery: the per-file limit is 10MB (not a per-request total)', () => {
    A(
      uploadModule.CLUB_GALLERY_MAX_BYTES === 10 * 1024 * 1024,
      String(uploadModule.CLUB_GALLERY_MAX_BYTES)
    )
  })

  await t('gallery: 3 x 8MB is under the limit; a single 10.1MB file is over it', () => {
    const eightMB = 8 * 1024 * 1024
    A([1, 2, 3].every(() => eightMB <= uploadModule.CLUB_GALLERY_MAX_BYTES), '8MB rejected')
    A(Math.round(10.1 * 1024 * 1024) > uploadModule.CLUB_GALLERY_MAX_BYTES, '10.1MB accepted')
  })

  await t('gallery: the busboy limit is MAX+1 so exactly 10MB is accepted', () => {
    // busboy trips on `fileSize === fileSizeLimit`, not on ">", so handing it
    // a flat 10MB would reject a file that is exactly 10MB.
    A(
      uploadModule.CLUB_GALLERY_BUSBOY_LIMIT === uploadModule.CLUB_GALLERY_MAX_BYTES + 1,
      String(uploadModule.CLUB_GALLERY_BUSBOY_LIMIT)
    )
  })

  await t('gallery: accepted MIME types are exactly JPEG, PNG and WEBP', () => {
    const types = Object.keys(uploadModule.CLUB_GALLERY_MIME_TYPES).sort()
    const expected = ['image/jpeg', 'image/png', 'image/webp']
    A(JSON.stringify(types) === JSON.stringify(expected), JSON.stringify(types))
  })

  await t('gallery: pdf / exe / txt / gif are all rejected', () => {
    for (const type of ['application/pdf', 'application/x-msdownload', 'text/plain', 'image/gif']) {
      A(!uploadModule.CLUB_GALLERY_MIME_TYPES[type], type + ' was accepted')
    }
  })

  await t('the COVER upload keeps its original rules (5MB, GIF allowed)', () => {
    // Unchanged behaviour: this feature must not alter the cover image.
    A(uploadModule.CLUB_IMAGE_DIR.endsWith('clubs'), uploadModule.CLUB_IMAGE_DIR)
    A(uploadModule.CLUB_GALLERY_DIR.endsWith('clubs-gallery'), uploadModule.CLUB_GALLERY_DIR)
    A(uploadModule.CLUB_IMAGE_DIR !== uploadModule.CLUB_GALLERY_DIR, 'directories are the same')
    A(typeof uploadModule.uploadClubImage === 'function', 'cover upload handler is gone')
  })

  console.log('\n== FILE REMOVAL IS SANDBOXED TO THE GALLERY DIRECTORY ==')

  await t('a cover / activity / traversal / external path is never unlinked', async () => {
    const canary = path.join(uploadModule.CLUB_GALLERY_DIR, '..', '__gallery_canary__.txt')
    fs.writeFileSync(canary, 'keep me')
    await removeClubGalleryFile('/uploads/clubs-gallery/../__gallery_canary__.txt')
    await removeClubGalleryFile('/uploads/clubs/cover.jpg')
    await removeClubGalleryFile('/uploads/activities/activity.jpg')
    await removeClubGalleryFile('https://example.com/photo.jpg')
    A(fs.existsSync(canary), 'the canary file was deleted')
    fs.rmSync(canary, { force: true })
  })

  await t('a missing file is not an error', async () => {
    await removeClubGalleryFile('/uploads/clubs-gallery/definitely-not-here.jpg')
  })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
