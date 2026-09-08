const fs = require('fs/promises')
const path = require('path')
const { ACTIVITY_IMAGE_DIR } = require('../middleware/upload')

// Public URL prefix that `express.static('/uploads', ...)` in app.js serves
// activity gallery files from.
const ACTIVITY_IMAGE_PREFIX = '/uploads/activities/'

exports.ACTIVITY_IMAGE_PREFIX = ACTIVITY_IMAGE_PREFIX

// Path stored on the activity for a file multer just wrote.
exports.toPublicPath = (filename) => `${ACTIVITY_IMAGE_PREFIX}${filename}`

// Best-effort removal of the file backing a stored image path.
//
// Only paths this app manages are ever touched: the value must start with
// "/uploads/activities/", and the resolved location must still sit inside
// ACTIVITY_IMAGE_DIR — so a crafted value such as
// "/uploads/activities/../../server.js" is ignored rather than followed.
// Legacy values (external URLs, or hand-entered paths pointing elsewhere) are
// left on disk untouched; only the database reference is dropped.
//
// A missing file is not an error: the reference is being removed anyway.
exports.removeActivityImageFile = async (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith(ACTIVITY_IMAGE_PREFIX)) return

  const filename = imagePath.slice(ACTIVITY_IMAGE_PREFIX.length)
  if (!filename || filename.includes('\0')) return

  const resolved = path.resolve(ACTIVITY_IMAGE_DIR, filename)
  const root = path.resolve(ACTIVITY_IMAGE_DIR) + path.sep
  if (!resolved.startsWith(root)) return

  try {
    await fs.unlink(resolved)
  } catch (err) {
    // ENOENT: already gone. Anything else (permissions, read-only mount) must
    // not fail the request — the reference removal is what the caller asked
    // for, and an orphaned file is harmless.
    if (err.code !== 'ENOENT') {
      console.error(`Failed to remove activity image file ${resolved}:`, err.message)
    }
  }
}

// Accepts the `images` / legacy `image` values a create request may carry and
// returns a clean, de-duplicated, order-preserving list of strings.
exports.sanitizeImageList = (images, legacyImage) => {
  const raw = []
  if (Array.isArray(images)) raw.push(...images)
  else if (typeof images === 'string') raw.push(images)
  if (typeof legacyImage === 'string') raw.push(legacyImage)

  const seen = new Set()
  const result = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}
