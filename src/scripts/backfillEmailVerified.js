// OPTIONAL, non-destructive, purely cosmetic backfill.
//
// Email verification has been REMOVED from the system: nothing reads
// `emailVerified` as a gate any more, so no account is blocked by it and this
// script is not required for anything to work. Run it only if you want every
// existing document to carry an explicit `emailVerified: true` flag for
// consistency with what registration and Google sign-in now write.
//
// It only fills in accounts that have NO `emailVerified` field at all. It will
// not change an account already flagged `false` — such accounts can log in
// normally regardless.
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
