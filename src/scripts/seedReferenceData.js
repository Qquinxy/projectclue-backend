// Seeds the selectable reference data (faculties / years / majors) used by
// the register form and the profile editor. Safe to re-run: existing entries
// are left untouched, only missing ones are inserted.
//
// Usage:
//   npm run seed:reference-data
require('dotenv').config()
const mongoose = require('mongoose')
const { MONGODB_URI } = require('../config/env')
const ReferenceData = require('../models/ReferenceData')

const DEFAULTS = [
  // --- Faculties -------------------------------------------------------
  { type: 'faculty', value: 'คณะวิศวกรรมศาสตร์', sortOrder: 1 },
  { type: 'faculty', value: 'คณะบริหารธุรกิจ', sortOrder: 2 },
  { type: 'faculty', value: 'คณะศิลปศาสตร์', sortOrder: 3 },
  { type: 'faculty', value: 'คณะสถาปัตยกรรมศาสตร์', sortOrder: 4 },

  // --- Years -----------------------------------------------------------
  { type: 'year', value: '1', label: 'ปี 1', sortOrder: 1 },
  { type: 'year', value: '2', label: 'ปี 2', sortOrder: 2 },
  { type: 'year', value: '3', label: 'ปี 3', sortOrder: 3 },
  { type: 'year', value: '4', label: 'ปี 4', sortOrder: 4 },

  // --- Majors (starter set — admin can add more via the admin UI) ------
  { type: 'major', value: 'วิศวกรรมคอมพิวเตอร์', sortOrder: 1 },
  { type: 'major', value: 'วิศวกรรมไฟฟ้า', sortOrder: 2 },
  { type: 'major', value: 'วิศวกรรมเครื่องกล', sortOrder: 3 },
  { type: 'major', value: 'การบัญชี', sortOrder: 4 },
  { type: 'major', value: 'การตลาด', sortOrder: 5 },
  { type: 'major', value: 'การจัดการธุรกิจดิจิทัล', sortOrder: 6 },
  { type: 'major', value: 'ภาษาไทย', sortOrder: 7 },
  { type: 'major', value: 'ภาษาอังกฤษ', sortOrder: 8 },
  { type: 'major', value: 'สถาปัตยกรรม', sortOrder: 9 },
  { type: 'major', value: 'การออกแบบภายใน', sortOrder: 10 },
]

const run = async () => {
  await mongoose.connect(MONGODB_URI)

  let inserted = 0
  for (const entry of DEFAULTS) {
    const existing = await ReferenceData.findOne({ type: entry.type, value: entry.value })
    if (existing) continue
    await ReferenceData.create(entry)
    inserted += 1
  }

  console.log(`Reference data seeded (${inserted} new, ${DEFAULTS.length - inserted} already present)`)
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})