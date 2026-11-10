// Storage service contract tests; all Supabase calls are mocked.
const assert = require('assert')
const {
  createStorageService,
  safeObjectKey,
  publicKeyFromLegacyPath,
  withDiagnosticContext,
  diagnosticFetch,
} = require('../src/services/storage.service')

async function main() {
  const calls = []
  const objects = new Map()
  const client = {
    storage: {
      from(bucket) {
        return {
          async upload(key, buffer, options) {
            calls.push(['upload', bucket, key, options])
            objects.set(`${bucket}/${key}`, Buffer.from(buffer))
            return { error: null }
          },
          getPublicUrl(key) {
            calls.push(['publicUrl', bucket, key])
            return { data: { publicUrl: `https://storage.test/${bucket}/${key}` } }
          },
          async createSignedUrl(key, expiresIn) {
            calls.push(['signedUrl', bucket, key, expiresIn])
            return { data: { signedUrl: `https://storage.test/${bucket}/${key}?expires=${expiresIn}` }, error: null }
          },
          async remove(keys) {
            calls.push(['remove', bucket, keys[0]])
            keys.forEach((key) => objects.delete(`${bucket}/${key}`))
            return { error: null }
          },
          async download(key) {
            calls.push(['download', bucket, key])
            const buffer = objects.get(`${bucket}/${key}`)
            if (!buffer) return { data: null, error: { statusCode: 404 } }
            return { data: { arrayBuffer: async () => buffer }, error: null }
          },
        }
      },
    },
  }
  const service = createStorageService(client, {
    SUPABASE_PUBLIC_BUCKET: 'public-bucket',
    SUPABASE_PRIVATE_BUCKET: 'private-bucket',
  })

  assert.equal(safeObjectKey('../secret'), null)
  assert.equal(publicKeyFromLegacyPath('/uploads/clubs/cover.jpg'), 'clubs/cover.jpg')
  assert.equal(publicKeyFromLegacyPath('/other/cover.jpg'), null)
  await service.uploadPublicObject('clubs/cover.jpg', Buffer.from('public'), 'image/jpeg')
  await service.uploadPrivateObject('activity-evidence/evidence.jpg', Buffer.from('private'), 'image/jpeg')
  assert(calls.some(([op, bucket]) => op === 'upload' && bucket === 'public-bucket'))
  assert(calls.some(([op, bucket]) => op === 'upload' && bucket === 'private-bucket'))
  assert.match(service.getPublicObjectUrl('clubs/cover.jpg'), /^https:\/\/storage\.test\/public-bucket/)
  assert.match(await service.createPrivateSignedUrl('activity-evidence/evidence.jpg', 120), /expires=120$/)
  await assert.rejects(service.createPrivateSignedUrl('activity-evidence/evidence.jpg', 601), /expiry/)
  assert.equal(await service.downloadObject('private', 'activity-evidence/evidence.jpg').then((b) => b.toString()), 'private')
  await service.removePrivateObject('activity-evidence/evidence.jpg')
  assert(!objects.has('private-bucket/activity-evidence/evidence.jpg'))

  const originalFetch = global.fetch
  const originalConsoleError = console.error
  const responseBodies = [
    { statusCode: '404', error: 'not_found', code: 'NoSuchKey' },
    { statusCode: '400', error: 'BadRequest', code: 'InvalidKey' },
  ]
  let responseIndex = 0
  const diagnosticClient = {
    storage: {
      from() {
        return {
          async download() {
            await diagnosticFetch('https://mock.supabase.test/object')
            return {
              data: null,
              error: Object.assign(new Error('HTTP 400'), { status: 400, statusCode: 400 }),
            }
          },
        }
      },
    },
  }
  const diagnosticService = createStorageService(diagnosticClient, {
    SUPABASE_PUBLIC_BUCKET: 'public-bucket',
    SUPABASE_PRIVATE_BUCKET: 'private-bucket',
  })
  const parentContext = { stage: 'download-existing-check' }
  global.fetch = async () => new Response(JSON.stringify(responseBodies[responseIndex++]), {
    status: 400,
    statusText: 'Bad Request',
  })
  console.error = () => {}
  try {
    await withDiagnosticContext(parentContext, async () => {
      await assert.rejects(diagnosticService.downloadObject('public', 'activities/missing.jpg'), (error) => {
        assert.deepEqual(error.storageResponseBody, responseBodies[0])
        return true
      })
      await assert.rejects(diagnosticService.downloadObject('public', 'activities/other.jpg'), (error) => {
        assert.deepEqual(error.storageResponseBody, responseBodies[1])
        return true
      })
    })
    assert.equal(Object.hasOwn(parentContext, 'storageResponseBody'), false)
  } finally {
    global.fetch = originalFetch
    console.error = originalConsoleError
  }

  console.log('PASS Storage service routes public/private objects, signs private URLs, validates keys, and removes objects')
  console.log('PASS Storage diagnostic response bodies are isolated to each download request')
}

main().catch((error) => {
  console.error('FAIL ' + error.message)
  process.exitCode = 1
})
