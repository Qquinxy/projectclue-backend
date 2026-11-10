const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const storage = require('../services/storage.service')

const ROOT = path.resolve(__dirname, '..', '..')
const PUBLIC_ROOT = path.join(ROOT, 'uploads')
const PRIVATE_ROOT = path.join(ROOT, 'private-uploads')
const execute = process.argv.includes('--execute')
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

async function collectFiles(root, kind, keyPrefix = '') {
  const entries = []
  const walk = async (directory) => {
    let children
    try {
      children = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const child of children) {
      const fullPath = path.join(directory, child.name)
      if (child.isDirectory()) await walk(fullPath)
      else if (child.isFile()) {
        const relative = path.relative(root, fullPath).split(path.sep).join('/')
        entries.push({ fullPath, kind, key: keyPrefix ? `${keyPrefix}/${relative}` : relative })
      }
    }
  }
  await walk(root)
  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

const parseResponseBody = (body) => {
  if (body && typeof body === 'object') return body
  if (typeof body !== 'string') return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

const isNotFound = (error) => {
  if (error?.statusCode === '404' || error?.statusCode === 404 || error?.status === 404) return true
  const body = parseResponseBody(error?.storageResponseBody ?? error?.responseBody ?? error?.body)
  return Boolean(body && (
    body.statusCode === '404' ||
    body.statusCode === 404 ||
    (body.error === 'not_found' && body.code === 'NoSuchKey')
  ))
}
let currentStep = { stage: 'startup' }

const setStep = (stage, entry) => {
  const bucket = entry.kind === 'public'
    ? (process.env.SUPABASE_PUBLIC_BUCKET || 'projectclue-public')
    : (process.env.SUPABASE_PRIVATE_BUCKET || 'projectclue-private')
  currentStep = { stage, bucket, objectPath: entry.key }
}

async function main() {
  const files = [
    ...await collectFiles(PUBLIC_ROOT, 'public'),
    ...await collectFiles(PRIVATE_ROOT, 'private'),
  ]
  console.log(`${execute ? 'COPY' : 'DRY RUN'}: ${files.length} local files; originals and MongoDB will not be changed.`)
  for (const entry of files) {
    setStep('read-source', entry)
    const original = await fs.readFile(entry.fullPath)
    console.log(`${entry.kind}/${entry.key} (${original.length} bytes)`)
    if (!execute) continue

    try {
      setStep('download-existing-check', entry)
      const remote = await storage.withDiagnosticContext(
        currentStep,
        () => storage.downloadObject(entry.kind, entry.key)
      )
      if (hash(remote) !== hash(original)) {
        setStep('checksum-compare', entry)
        throw new Error(`Remote object differs; refusing to overwrite: ${entry.kind}/${entry.key}`)
      }
      console.log(`  verified existing object`)
      continue
    } catch (error) {
      if (!isNotFound(error)) throw error
    }

    const contentType = CONTENT_TYPES[path.extname(entry.key).toLowerCase()]
    if (!contentType) throw new Error(`Unsupported image extension: ${entry.key}`)
    setStep('upload', entry)
    await storage.withDiagnosticContext(currentStep, () =>
      entry.kind === 'public'
        ? storage.uploadPublicObject(entry.key, original, contentType)
        : storage.uploadPrivateObject(entry.key, original, contentType)
    )

    setStep('checksum-download', entry)
    const verified = await storage.withDiagnosticContext(
      currentStep,
      () => storage.downloadObject(entry.kind, entry.key)
    )
    setStep('checksum-compare', entry)
    if (hash(verified) !== hash(original)) throw new Error(`Checksum verification failed: ${entry.kind}/${entry.key}`)
    console.log('  uploaded and checksum verified')
  }
  if (!execute) console.log('No upload was performed. Pass --execute only after reviewing this manifest.')
}

if (require.main === module) {
  main().catch((error) => {
    const details = storage.diagnosticErrorDetails(error)
    console.error('Storage copy stopped:', JSON.stringify({
      stage: storage.boundedDiagnosticText(currentStep.stage),
      bucket: storage.boundedDiagnosticText(currentStep.bucket),
      objectPath: storage.boundedDiagnosticText(currentStep.objectPath),
      ...details,
    }))
    process.exitCode = 1
  })
}

module.exports = { isNotFound }
