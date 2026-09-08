// Pure-logic tests (no DB required)
const { getPasswordErrors, isStrongPassword } = require('../src/utils/password')
const { validateRegisterInput } = require('../src/validators/auth.validator')
const { validateCreateClubAdminInput, validateAssignClubsInput } = require('../src/validators/adminUser.validator')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); console.log('  PASS ' + name); pass++ } catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++ } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }
const throws = (fn, re) => { try { fn(); throw new Error('expected throw') } catch (e) { if (e.message === 'expected throw') throw e; if (re && !re.test(e.message)) throw new Error('wrong msg: ' + e.message) } }

console.log('\n== PASSWORD POLICY ==')
t('valid ProjectClue@2026', () => assert(isStrongPassword('ProjectClue@2026')))
t('reject projectclue123 (no upper/special)', () => assert(!isStrongPassword('projectclue123')))
t('reject too short Ab1@xyz (7)', () => assert(!isStrongPassword('Ab1@xyz')))
t('reject no uppercase', () => assert(getPasswordErrors('abcdefg1@').some(e => /uppercase/.test(e))))
t('reject no lowercase', () => assert(getPasswordErrors('ABCDEFG1@').some(e => /lowercase/.test(e))))
t('reject no number', () => assert(getPasswordErrors('Abcdefgh@').some(e => /number/.test(e))))
t('reject no special', () => assert(getPasswordErrors('Abcdefg1').some(e => /special/.test(e))))
t('empty password required', () => assert(getPasswordErrors('').length === 1))

console.log('\n== REGISTER VALIDATION (backend enforces policy) ==')
const base = { studentId: '67543206105-8', firstName: 'A', lastName: 'B', email: 'a@b.co', faculty: 'F', major: 'M', year: 1 }
t('accepts strong password', () => validateRegisterInput({ ...base, password: 'ProjectClue@2026' }))
t('rejects weak password (bypassed frontend)', () => throws(() => validateRegisterInput({ ...base, password: 'projectclue123' }), /uppercase|special/))
t('rejects 6-char legacy password', () => throws(() => validateRegisterInput({ ...base, password: 'Ab1@cd' }), /8 characters/))

console.log('\n== CLUB ADMIN: MULTIPLE CLUBS ALLOWED ==')
const oid = () => require('mongoose').Types.ObjectId().toString ? null : null
const ids = ['507f1f77bcf86cd799439011','507f1f77bcf86cd799439012','507f1f77bcf86cd799439013']
t('assign 3 clubs accepted', () => validateAssignClubsInput({ managedClubs: ids }))
t('assign 1 club accepted', () => validateAssignClubsInput({ managedClubs: [ids[0]] }))
t('assign 0 clubs accepted', () => validateAssignClubsInput({ managedClubs: [] }))
t('rejects non-array', () => throws(() => validateAssignClubsInput({ managedClubs: ids[0] })))
t('rejects invalid id', () => throws(() => validateAssignClubsInput({ managedClubs: ['nope'] })))
t('create club_admin with 3 clubs + strong pw', () => validateCreateClubAdminInput({ studentId: 'x', firstName: 'A', lastName: 'B', email: 'a@b.co', password: 'ProjectClue@2026', managedClubs: ids }))
t('create club_admin rejects weak pw', () => throws(() => validateCreateClubAdminInput({ studentId: 'x', firstName: 'A', lastName: 'B', email: 'a@b.co', password: 'weak', managedClubs: ids }), /8 characters/))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
