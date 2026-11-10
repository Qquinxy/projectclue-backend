const assert = require('assert')
const {
  sanitizeDiagnosticText,
  boundedDiagnosticText,
  diagnosticErrorDetails,
} = require('../src/services/storage.service')

const cases = [
  '{"apiKey":"LEAK_TEST"',
  "{'token':'LEAK_TEST'",
  'secret=LEAK_TEST',
  'authorization: LEAK_TEST',
  'apiKey: LEAK_TEST',
]

for (const input of cases) {
  const output = sanitizeDiagnosticText(input)
  assert(!output.includes('LEAK_TEST'), `secret survived redaction: ${output}`)
  assert(output.includes('[REDACTED]'), `redaction marker missing: ${output}`)
}

const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = 'LEAK_TEST'
assert(!sanitizeDiagnosticText('LEAK_TEST').includes('LEAK_TEST'))
if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey

const deepNetworkError = Object.assign(new Error('fetch failed https://private.example/path?token=LEAK_TEST'), {
  cause: Object.assign(new Error('socket failed'), { code: 'ECONNRESET' }),
})
const outerError = Object.assign(new Error('storage request failed'), {
  statusCode: '400',
  originalError: deepNetworkError,
})
outerError.cause = outerError

const details = diagnosticErrorDetails(outerError)
assert.equal(details.message, 'storage request failed')
assert.equal(details.statusCode, '400')
assert.equal(details.code, 'ECONNRESET')
assert(!JSON.stringify(details).includes('LEAK_TEST'))
assert(!JSON.stringify(details).includes('https://'))
assert(!JSON.stringify(details).includes('stack'))

for (const networkCode of ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT']) {
  let nested = { code: networkCode }
  for (let depth = 0; depth < 6; depth += 1) nested = { cause: nested }
  assert.equal(diagnosticErrorDetails(nested).code, networkCode)
}

const bounded = boundedDiagnosticText(`Bearer LEAK_TEST ${'x'.repeat(3000)}`)
assert(bounded.length <= 2000)
assert(!bounded.includes('LEAK_TEST'))
assert(bounded.includes('Bearer [REDACTED]'))

const statusAndCode = diagnosticErrorDetails({
  message: 'request failed',
  statusCode: 'https://private.example?apiKey=LEAK_TEST',
  code: 'Bearer LEAK_TEST',
})
assert(!JSON.stringify(statusAndCode).includes('LEAK_TEST'))
assert(!JSON.stringify(statusAndCode).includes('https://'))
assert(statusAndCode.statusCode.length <= 2000)
assert(statusAndCode.code.includes('Bearer [REDACTED]'))

console.log('PASS Storage diagnostic redaction, recursive network error details, circular/depth safety, and bounded final fields')
