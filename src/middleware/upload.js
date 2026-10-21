const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')
const AppError = require('../utils/AppError')

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads')
// Three separate directories for three separate concepts, so a file can
// never be mistaken for one of the others:
//   clubs/         -> the single club cover/profile image  (Club.image)
//   clubs-gallery/ -> the club's own photo gallery         (Club.galleryImages)
//   activities/    -> activity images                      (Activity)
const CLUB_IMAGE_DIR = path.join(UPLOAD_ROOT, 'clubs')
const CLUB_GALLERY_DIR = path.join(UPLOAD_ROOT, 'clubs-gallery')
const ACTIVITY_IMAGE_DIR = path.join(UPLOAD_ROOT, 'activities')
const PRIVATE_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'private-uploads')
const ACTIVITY_EVIDENCE_DIR = path.join(PRIVATE_UPLOAD_ROOT, 'activity-evidence')
fs.mkdirSync(CLUB_IMAGE_DIR, { recursive: true })
fs.mkdirSync(CLUB_GALLERY_DIR, { recursive: true })
fs.mkdirSync(ACTIVITY_IMAGE_DIR, { recursive: true })
fs.mkdirSync(ACTIVITY_EVIDENCE_DIR, { recursive: true })

// The single club COVER image. Unchanged from the original feature:
// JPEG/PNG/WEBP/GIF at up to 5MB, one file per request.
const CLUB_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

// The club PHOTO GALLERY (Club.galleryImages) — a different concept from the
// cover, with its own rules: JPEG/PNG/WEBP only, 10MB PER FILE, many per
// request.
const CLUB_GALLERY_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const CLUB_GALLERY_MAX_BYTES = 10 * 1024 * 1024 // 10MB PER FILE (not per request)

// Cap on how many files one multipart request may carry. This is not a cap on
// how many photos a club's gallery can hold — the endpoint can be called as
// many times as needed and appends every time — it only stops a single
// request from tying up the process with an unbounded number of parts.
const CLUB_GALLERY_PER_REQUEST = 20

// What is actually handed to busboy. The +1 is deliberate: busboy trips its
// limit when the byte count REACHES `fileSize` (`if (fileSize === fileSizeLimit)`),
// not when it exceeds it, so passing a flat 10MB would reject a file of
// exactly 10,485,760 bytes. With the +1, "10MB or smaller" is accepted and
// anything larger is not.
const CLUB_GALLERY_BUSBOY_LIMIT = CLUB_GALLERY_MAX_BYTES + 1

// Activity galleries accept JPEG/PNG/WEBP only — no GIF.
const ACTIVITY_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const ACTIVITY_IMAGE_MAX_BYTES = 10 * 1024 * 1024 // 10MB PER FILE (not per request)

// Cap on how many files one multipart request may carry. This is not a cap on
// how many images an activity can hold — the endpoint can be called as many
// times as needed and appends every time — it only stops a single request from
// tying up the process with an unbounded number of parts.
const ACTIVITY_IMAGES_PER_REQUEST = 20

// What is actually handed to busboy — see the comment on `limits` below.
const ACTIVITY_IMAGE_BUSBOY_LIMIT = ACTIVITY_IMAGE_MAX_BYTES + 1

const makeStorage = (dir, mimeTypes) =>
  multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = mimeTypes[file.mimetype] || path.extname(file.originalname)
      cb(null, `${crypto.randomUUID()}${ext}`)
    },
  })

const makeFileFilter = (mimeTypes, message) => (req, file, cb) => {
  if (!mimeTypes[file.mimetype]) {
    return cb(new AppError(message, 400))
  }
  cb(null, true)
}

const clubImageUpload = multer({
  storage: makeStorage(CLUB_IMAGE_DIR, CLUB_MIME_TYPES),
  fileFilter: makeFileFilter(CLUB_MIME_TYPES, 'Image must be JPEG, PNG, WEBP, or GIF'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

const clubGalleryUpload = multer({
  storage: makeStorage(CLUB_GALLERY_DIR, CLUB_GALLERY_MIME_TYPES),
  fileFilter: makeFileFilter(CLUB_GALLERY_MIME_TYPES, 'Images must be JPEG, PNG, or WEBP'),
  // `fileSize` is applied by multer to EACH file individually, so three 8MB
  // photos pass while one 10.1MB photo is rejected. It is never a budget for
  // the request as a whole.
  limits: { fileSize: CLUB_GALLERY_BUSBOY_LIMIT, files: CLUB_GALLERY_PER_REQUEST },
})

const activityImagesUpload = multer({
  storage: makeStorage(ACTIVITY_IMAGE_DIR, ACTIVITY_MIME_TYPES),
  fileFilter: makeFileFilter(ACTIVITY_MIME_TYPES, 'Images must be JPEG, PNG, or WEBP'),
  // `fileSize` is applied by multer to EACH file individually, so five 8MB
  // images pass while one 10.1MB image is rejected. It is never a budget for
  // the request as a whole.
  //
  // The +1 is deliberate: busboy trips its limit when the byte count REACHES
  // `fileSize` (`if (fileSize === fileSizeLimit)`), not when it exceeds it, so
  // passing the flat 10MB would reject a file of exactly 10,485,760 bytes.
  // With the +1, "10MB or smaller" is accepted and anything larger is not.
  limits: { fileSize: ACTIVITY_IMAGE_BUSBOY_LIMIT, files: ACTIVITY_IMAGES_PER_REQUEST },
})

// Evidence is stored outside uploads/, which is exposed by express.static.
// Its content type is verified from the decoded image after upload, not from
// the client supplied MIME type or filename.
const ACTIVITY_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
const activityEvidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ACTIVITY_EVIDENCE_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: ACTIVITY_EVIDENCE_MAX_BYTES + 1, files: 1 },
})

// Wraps multer's callback-style error (e.g. file too large, wrong field
// name) into the app's AppError -> errorHandler flow instead of letting it
// fall through as an unhandled 500.
const wrapMulterErrors = (handler, messages) => (req, res, next) => {
  handler(req, res, (err) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(messages.tooLarge, 400))
      if (err.code === 'LIMIT_FILE_COUNT') return next(new AppError(messages.tooMany, 400))
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(messages.wrongField, 400))
      return next(new AppError(err.message, 400))
    }
    // Anything else raised while parsing the body (a malformed/truncated
    // multipart stream, for instance) is a bad request, not a server fault.
    if (!err.statusCode) return next(new AppError('Malformed upload request', 400))
    next(err)
  })
}

// The club COVER image — one file under the "image" field. Unchanged.
exports.uploadClubImage = wrapMulterErrors(clubImageUpload.single('image'), {
  tooLarge: 'Image must be 5MB or smaller',
  tooMany: 'Only one image may be uploaded at a time',
  wrongField: 'Unexpected file field — use "image"',
})

// The club PHOTO GALLERY — multiple files in one request under the "images"
// field. Writes to clubs-gallery/, never to clubs/.
exports.uploadClubGalleryImages = wrapMulterErrors(
  clubGalleryUpload.array('images', CLUB_GALLERY_PER_REQUEST),
  {
    tooLarge: 'Each image must be 10MB or smaller',
    tooMany: `You can upload at most ${CLUB_GALLERY_PER_REQUEST} images per request`,
    wrongField: 'Unexpected file field — use "images"',
  }
)

// Multiple files in one request under the "images" field.
exports.uploadActivityImages = wrapMulterErrors(
  activityImagesUpload.array('images', ACTIVITY_IMAGES_PER_REQUEST),
  {
    tooLarge: 'Each image must be 10MB or smaller',
    tooMany: `You can upload at most ${ACTIVITY_IMAGES_PER_REQUEST} images per request`,
    wrongField: 'Unexpected file field — use "images"',
  }
)

exports.uploadActivityEvidence = wrapMulterErrors(activityEvidenceUpload.single('evidence'), {
  tooLarge: 'Evidence image must be 10MB or smaller',
  tooMany: 'Only one evidence image may be uploaded at a time',
  wrongField: 'Unexpected file field — use "evidence"',
})

exports.CLUB_IMAGE_DIR = CLUB_IMAGE_DIR
exports.CLUB_GALLERY_DIR = CLUB_GALLERY_DIR
exports.CLUB_GALLERY_MAX_BYTES = CLUB_GALLERY_MAX_BYTES
exports.CLUB_GALLERY_BUSBOY_LIMIT = CLUB_GALLERY_BUSBOY_LIMIT
exports.CLUB_GALLERY_PER_REQUEST = CLUB_GALLERY_PER_REQUEST
exports.CLUB_GALLERY_MIME_TYPES = CLUB_GALLERY_MIME_TYPES
exports.ACTIVITY_IMAGE_DIR = ACTIVITY_IMAGE_DIR
exports.ACTIVITY_IMAGE_MAX_BYTES = ACTIVITY_IMAGE_MAX_BYTES
exports.ACTIVITY_IMAGE_BUSBOY_LIMIT = ACTIVITY_IMAGE_BUSBOY_LIMIT
exports.ACTIVITY_IMAGES_PER_REQUEST = ACTIVITY_IMAGES_PER_REQUEST
exports.ACTIVITY_IMAGE_MIME_TYPES = ACTIVITY_MIME_TYPES
exports.ACTIVITY_EVIDENCE_DIR = ACTIVITY_EVIDENCE_DIR
exports.ACTIVITY_EVIDENCE_MAX_BYTES = ACTIVITY_EVIDENCE_MAX_BYTES
