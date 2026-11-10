const assert = require('assert')
const { isNotFound } = require('../src/scripts/copyLocalUploadsToSupabase')

const tests = [
  ['response body statusCode 404', {
    status: 400,
    statusCode: 400,
    storageResponseBody: { statusCode: '404', error: 'not_found', message: 'Object not found', code: 'NoSuchKey' },
  }, true],
  ['not_found with NoSuchKey', {
    status: 400,
    statusCode: '400',
    storageResponseBody: { error: 'not_found', code: 'NoSuchKey' },
  }, true],
  ['HTTP 400 with unrelated response body', {
    status: 400,
    statusCode: '400',
    storageResponseBody: { statusCode: '400', error: 'BadRequest', code: 'InvalidKey' },
  }, false],
  ['not_found with a different code', {
    status: 400,
    statusCode: '400',
    storageResponseBody: { error: 'not_found', code: 'OtherCode' },
  }, false],
  ['HTTP 401', { status: 401, statusCode: '401' }, false],
  ['HTTP 403', { status: 403, statusCode: '403' }, false],
  ['direct statusCode 404', { status: 400, statusCode: 404 }, true],
]

for (const [name, error, expected] of tests) {
  assert.strictEqual(isNotFound(error), expected, name)
}

console.log(`PASS copyLocalUploadsToSupabase isNotFound (${tests.length} cases)`)
