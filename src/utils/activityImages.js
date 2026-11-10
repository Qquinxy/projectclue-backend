const path = require('path')
const storage = require('../services/storage.service')

const ACTIVITY_IMAGE_PREFIX = '/uploads/activities/'
exports.ACTIVITY_IMAGE_PREFIX = ACTIVITY_IMAGE_PREFIX
exports.toPublicPath = (filename) => `${ACTIVITY_IMAGE_PREFIX}${filename}`

// Only remove one activity object. Local source files stay intact for safe
// migration and recovery.
exports.removeActivityImageFile = async (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith(ACTIVITY_IMAGE_PREFIX)) return
  const filename = imagePath.slice(ACTIVITY_IMAGE_PREFIX.length)
  if (!filename || path.posix.basename(filename) !== filename) return
  try {
    await storage.removePublicObject(`activities/${filename}`)
  } catch (error) {
    console.error(`Failed to remove activity image object ${filename}:`, error.message)
  }
}

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
