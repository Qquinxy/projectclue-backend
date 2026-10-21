const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const { ACTIVITY_EVIDENCE_DIR } = require('../middleware/upload')
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
  if (!uploadedFile?.path) throw new AppError('Evidence image is required', 400)

  let outputPath
  try {
    // Read once so the temporary disk file can be removed reliably on Windows
    // after Sharp has finished processing the in-memory bytes.
    const input = await fs.readFile(uploadedFile.path)
    const metadata = await sharp(input, { failOn: 'warning' }).metadata()
    const format = FORMATS[metadata.format]
    if (!format) {
      throw new AppError('Evidence must be a valid JPEG, PNG, or WebP image', 400)
    }

    const filename = `${crypto.randomUUID()}${format.extension}`
    outputPath = evidenceFilePath(filename)
    await sharp(input, { failOn: 'warning' })
      .rotate()
      .toFormat(metadata.format)
      .toFile(outputPath)

    return { filename, contentType: format.contentType, uploadedAt: new Date() }
  } catch (error) {
    if (outputPath) await fs.unlink(outputPath).catch(() => {})
    if (error instanceof AppError) throw error
    throw new AppError('Evidence must be a valid JPEG, PNG, or WebP image', 400)
  } finally {
    await fs.unlink(uploadedFile.path).catch(() => {})
  }
}

exports.readActivityEvidence = async (evidence) => {
  const fullPath = evidenceFilePath(evidence?.filename)
  if (!fullPath || !FORMATS[Object.keys(FORMATS).find((format) => FORMATS[format].contentType === evidence.contentType)]) {
    throw new AppError('Evidence image not found', 404)
  }

  try {
    await fs.access(fullPath)
  } catch {
    throw new AppError('Evidence image not found', 404)
  }
  return fullPath
}

exports.removeActivityEvidence = async (filename) => {
  const fullPath = evidenceFilePath(filename)
  if (!fullPath) return
  try {
    await fs.unlink(fullPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

exports.ACTIVITY_EVIDENCE_FORMATS = FORMATS
