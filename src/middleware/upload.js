const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')
const AppError = require('../utils/AppError')

const CLUB_IMAGE_DIR = path.join(__dirname, '..', '..', 'uploads', 'clubs')
fs.mkdirSync(CLUB_IMAGE_DIR, { recursive: true })

const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CLUB_IMAGE_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname)
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new AppError('Image must be JPEG, PNG, WEBP, or GIF', 400))
  }
  cb(null, true)
}

const clubImageUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

// Wraps multer's callback-style error (e.g. file too large, wrong field
// name) into the app's AppError -> errorHandler flow instead of letting it
// fall through as an unhandled 500.
exports.uploadClubImage = (req, res, next) => {
  clubImageUpload.single('image')(req, res, (err) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Image must be 5MB or smaller', 400))
      }
      return next(new AppError(err.message, 400))
    }
    next(err)
  })
}

exports.CLUB_IMAGE_DIR = CLUB_IMAGE_DIR
