const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const { ACTIVITY_EVIDENCE_DIR, getUploadBuffer, cleanupTempFile } = require('../middleware/upload')
const storage = require('../services/storage.service')
const AppError = require('./AppError')

const FORMATS = {
  jpeg: { contentType: 'image/jpeg', extension: '.jpg' },
  png: { contentType: 'image/png', extension: '.png' },
  webp: { contentType: 'image/webp', extension: '.webp' },
}

const evidenceFilePath = (filename) => {
  if (typeof filename !== 'string' || path.basename(filename) !== filename) return null
  const fullPath = path.resolve(ACTIVITY_EVIDENCE_DIR, filename)
  const root = path.resolve(ACTIVITY_EVIDENCE_DIR) + path.sep
  return fullPath.startsWith(root) ? fullPath : null
}

exports.processActivityEvidence = async (uploadedFile) => {
  if (!uploadedFile?.path && !Buffer.isBuffer(uploadedFile?.buffer)) {
    throw new AppError('Evidence image is required', 400)
  }

  try {
    const input = await getUploadBuffer(uploadedFile)
    const metadata = await sharp(input, { failOn: 'warning' }).metadata()
    const format = FORMATS[metadata.format]
    if (!format) {
      throw new AppError('Evidence must be a valid JPEG, PNG, or WebP image', 400)
    }

    const output = await sharp(input, { failOn: 'warning' })
      .rotate()
      .toFormat(metadata.format)
      .toBuffer()
    const filename = `${crypto.randomUUID()}${format.extension}`
    await storage.uploadPrivateObject(`activity-evidence/${filename}`, output, format.contentType)

    return { filename, contentType: format.contentType, uploadedAt: new Date() }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error?.statusCode >= 500) throw error
    throw new AppError('Evidence must be a valid JPEG, PNG, or WebP image', 400)
  } finally {
    await cleanupTempFile(uploadedFile)
  }
}

// A filename in MongoDB remains unchanged. Both legacy local records and new
// Supabase records map to `activity-evidence/<filename>` in the private bucket.
// Only callers behind the existing ownership/club authorization routes should
// invoke this function. Local fallback keeps old files readable during rollout.
exports.readActivityEvidence = async (evidence) => {
  const filename = evidence?.filename
  const localPath = evidenceFilePath(filename)
  const format = Object.values(FORMATS).find((item) => item.contentType === evidence?.contentType)
  if (!localPath || !format || path.extname(filename) !== format.extension) {
    throw new AppError('Evidence image not found', 404)
  }

  try {
    return await storage.createPrivateSignedUrl(`activity-evidence/${filename}`, 120)
  } catch {
    try {
      await fs.access(localPath)
      return localPath
    } catch {
      throw new AppError('Evidence image not found', 404)
    }
  }
}

// Delete only the private Supabase object. Legacy local files remain intact as
// migration sources and are never removed by this helper.
exports.removeActivityEvidence = async (filename) => {
  if (!evidenceFilePath(filename)) return
  await storage.removePrivateObject(`activity-evidence/${filename}`)
}

exports.ACTIVITY_EVIDENCE_FORMATS = FORMATS
