const { AsyncLocalStorage } = require('async_hooks')

const PUBLIC_BUCKET = 'SUPABASE_PUBLIC_BUCKET'
const PRIVATE_BUCKET = 'SUPABASE_PRIVATE_BUCKET'
const diagnosticStorage = new AsyncLocalStorage()
const SECRET_FIELD = /authorization|api[-_]?key|service[-_]?role[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|jwt/i
const MAX_DIAGNOSTIC_TEXT = 2000

const sanitizeDiagnosticText = (value) => {
  let text = String(value ?? '')
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (secret) text = text.split(secret).join('[REDACTED]')
  return text
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:["']?)(?:authorization|api[-_]?key|service[-_]?role[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|jwt)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\s}&;]+)/gi,
      '$1"[REDACTED]"'
    )
}

const boundedDiagnosticText = (value) => {
  const text = sanitizeDiagnosticText(value)
  const suffix = '[TRUNCATED]'
  return text.length > MAX_DIAGNOSTIC_TEXT
    ? `${text.slice(0, MAX_DIAGNOSTIC_TEXT - suffix.length)}${suffix}`
    : text
}

const diagnosticErrorDetails = (error, maxDepth = 8) => {
  const seen = new Set()
  const queue = [{ value: error, depth: 0 }]
  let message = ''
  let statusCode = null
  let code = ''

  while (queue.length) {
    const { value, depth } = queue.shift()
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value) || depth > maxDepth) continue
    seen.add(value)

    if (!message && value.message != null) message = boundedDiagnosticText(value.message)
    if (statusCode == null && (value.statusCode != null || value.status != null)) {
      statusCode = boundedDiagnosticText(value.statusCode ?? value.status)
    }
    if (!code && (value.code != null || value.error != null)) code = boundedDiagnosticText(value.code ?? value.error)
    if (depth < maxDepth) {
      queue.push({ value: value.cause, depth: depth + 1 }, { value: value.originalError, depth: depth + 1 })
    }
  }

  return {
    message: message || boundedDiagnosticText(error),
    statusCode: statusCode == null ? null : boundedDiagnosticText(statusCode),
    code: code || '',
  }
}

const redactDiagnosticValue = (value) => {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? '[REDACTED]' : redactDiagnosticValue(item),
    ]))
  }
  return typeof value === 'string' ? sanitizeDiagnosticText(value) : value
}

const redactDiagnosticBody = (body) => {
  let text = String(body ?? '')
  try {
    text = JSON.stringify(redactDiagnosticValue(JSON.parse(text)))
  } catch {
    text = sanitizeDiagnosticText(text)
  }
  text = sanitizeDiagnosticText(text)
  return { body: text.slice(0, MAX_DIAGNOSTIC_TEXT), bodyTruncated: text.length > MAX_DIAGNOSTIC_TEXT }
}

const diagnosticFetch = async (...args) => {
  const response = await global.fetch(...args)
  if (!response.ok) {
    const context = diagnosticStorage.getStore()
    if (context) context.storageResponseBody = null
    let bodyDetails
    try {
      const responseText = await response.clone().text()
      if (context) {
        try {
          context.storageResponseBody = JSON.parse(responseText)
        } catch {
          context.storageResponseBody = null
        }
      }
      bodyDetails = redactDiagnosticBody(responseText)
    } catch {
      bodyDetails = { body: '[response body unavailable]', bodyTruncated: false }
    }
    const safeContext = { ...context }
    delete safeContext.storageResponseBody
    console.error('[Supabase Storage HTTP error]', JSON.stringify({
      ...safeContext,
      status: response.status,
      statusText: sanitizeDiagnosticText(response.statusText),
      ...bodyDetails,
    }))
  }
  return response
}

const safeObjectKey = (value) => {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')) return null
  const key = value.replace(/^\/+/, '')
  const segments = key.split('/')
  if (!key || segments.some((part) => !part || part === '.' || part === '..')) return null
  return segments.join('/')
}

const errorFrom = (error, fallback) => {
  const wrapped = new Error(error?.message || fallback)
  wrapped.statusCode = 502
  wrapped.cause = error
  return wrapped
}

function createStorageService(client, config = process.env) {
  const bucketFor = (kind) => {
    const name = kind === 'public' ? config[PUBLIC_BUCKET] : kind === 'private' ? config[PRIVATE_BUCKET] : null
    if (!name) throw new Error(`Missing ${kind === 'public' ? PUBLIC_BUCKET : PRIVATE_BUCKET} configuration`)
    return name
  }

  return {
    async uploadPublicObject(key, buffer, contentType) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) throw new Error('Invalid public storage object key')
      const { error } = await client.storage.from(bucketFor('public')).upload(safeKey, buffer, {
        contentType,
        upsert: false,
      })
      if (error) throw errorFrom(error, 'Unable to upload public image')
      return safeKey
    },

    async uploadPrivateObject(key, buffer, contentType) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) throw new Error('Invalid private storage object key')
      const { error } = await client.storage.from(bucketFor('private')).upload(safeKey, buffer, {
        contentType,
        upsert: false,
      })
      if (error) throw errorFrom(error, 'Unable to upload private file')
      return safeKey
    },

    getPublicObjectUrl(key) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) throw new Error('Invalid public storage object key')
      const { data } = client.storage.from(bucketFor('public')).getPublicUrl(safeKey)
      if (!data?.publicUrl) throw new Error('Unable to create public image URL')
      return data.publicUrl
    },

    async createPrivateSignedUrl(key, expiresIn = 120) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) throw new Error('Invalid private storage object key')
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 600) {
        throw new Error('Private signed URL expiry must be between 1 and 600 seconds')
      }
      const { data, error } = await client.storage.from(bucketFor('private')).createSignedUrl(safeKey, expiresIn)
      if (error) throw errorFrom(error, 'Unable to create private file URL')
      if (!data?.signedUrl) throw new Error('Unable to create private file URL')
      return data.signedUrl
    },

    async removePublicObject(key) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) return false
      const { error } = await client.storage.from(bucketFor('public')).remove([safeKey])
      if (error) throw errorFrom(error, 'Unable to delete public image')
      return true
    },

    async removePrivateObject(key) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) return false
      const { error } = await client.storage.from(bucketFor('private')).remove([safeKey])
      if (error) throw errorFrom(error, 'Unable to delete private file')
      return true
    },

    async downloadObject(kind, key) {
      const safeKey = safeObjectKey(key)
      if (!safeKey) throw new Error('Invalid storage object key')

      const parentContext = diagnosticStorage.getStore()
      const downloadContext = parentContext
        ? { ...parentContext, storageResponseBody: null }
        : null
      const performDownload = async () => {
        const { data, error } = await client.storage.from(bucketFor(kind)).download(safeKey)
        if (error) {
          const responseBody = diagnosticStorage.getStore()?.storageResponseBody
          if (responseBody && typeof error === 'object' && Object.isExtensible(error)) {
            error.storageResponseBody = responseBody
          }
          throw error
        }
        if (!data) throw new Error('Storage object is missing')
        return Buffer.from(await data.arrayBuffer())
      }

      return downloadContext
        ? diagnosticStorage.run(downloadContext, performDownload)
        : performDownload()
    },
  }
}

let singleton
const getService = () => {
  if (singleton) return singleton
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Supabase Storage is not configured')
    error.statusCode = 500
    throw error
  }
  const { createClient } = require('@supabase/supabase-js')
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: diagnosticFetch },
  })
  singleton = createStorageService(client)
  return singleton
}

exports.safeObjectKey = safeObjectKey
exports.createStorageService = createStorageService
exports.withDiagnosticContext = (context, callback) => diagnosticStorage.run(context, callback)
exports.sanitizeDiagnosticText = sanitizeDiagnosticText
exports.boundedDiagnosticText = boundedDiagnosticText
exports.diagnosticErrorDetails = diagnosticErrorDetails
exports.diagnosticFetch = diagnosticFetch
exports.uploadPublicObject = (...args) => getService().uploadPublicObject(...args)
exports.uploadPrivateObject = (...args) => getService().uploadPrivateObject(...args)
exports.getPublicObjectUrl = (...args) => getService().getPublicObjectUrl(...args)
exports.createPrivateSignedUrl = (...args) => getService().createPrivateSignedUrl(...args)
exports.removePublicObject = (...args) => getService().removePublicObject(...args)
exports.removePrivateObject = (...args) => getService().removePrivateObject(...args)
exports.downloadObject = (...args) => getService().downloadObject(...args)
exports.publicKeyFromLegacyPath = (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith('/uploads/')) return null
  return safeObjectKey(imagePath.slice('/uploads/'.length))
}
