// OPTIONAL, non-destructive backfill for accounts that existed before email
// verification was introduced.
//
// It is not required: login only blocks on an explicit `emailVerified: false`,
// so legacy accounts (which have no such field) already keep working. Run this
// only if you prefer every existing account to carry an explicit
// `emailVerified: true` flag.
//
// It never deletes anything and never touches accounts that already have the
// field set (in particular, it will NOT verify a pending new registration).
//
// Usage:
//   node src/scripts/backfillEmailVerified.js
require('dotenv').config()
const mongoose = require('mongoose')
const { MONGODB_URI } = require('../config/env')
const User = require('../models/User')

const run = async () => {
  await mongoose.connect(MONGODB_URI)

  const filter = { emailVerified: { $exists: false } }
  const pending = await User.countDocuments(filter)

  if (pending === 0) {
    console.log('No legacy accounts found — nothing to backfill.')
  } else {
    const result = await User.updateMany(filter, {
      $set: { emailVerified: true, emailVerifiedAt: new Date() },
    })
    console.log(`Marked ${result.modifiedCount} pre-existing account(s) as verified.`)
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
