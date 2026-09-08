// OPTIONAL, non-destructive backfill. NOT required for anything to work.
//
// Activities now store their gallery in `images: string[]`. Documents created
// before that still carry the single legacy `image: string`. The API already
// surfaces those transparently — the Activity schema's serializer reports a
// one-element `images` list whenever `images` is empty and `image` is set —
// so old activities keep displaying their picture with no migration at all.
//
// Run this only if you would rather have the data itself normalized (e.g. to
// query on `images` directly in the database).
//
// What it does, exactly:
//   - finds activities where `image` is a non-empty string AND `images` is
//     missing or empty
//   - sets `images` to [image] on those documents
//   - leaves `image` in place, untouched
//
// What it never does:
//   - it never deletes a document, a field, or a file
//   - it never touches an activity that already has an `images` list
//   - it never modifies any other collection
//
// It is idempotent: running it twice changes nothing the second time.
//
// Usage:
//   node src/scripts/backfillActivityImages.js
require('dotenv').config()
const mongoose = require('mongoose')
const { MONGODB_URI } = require('../config/env')
const Activity = require('../models/Activity')

const run = async () => {
  await mongoose.connect(MONGODB_URI)

  const filter = {
    image: { $type: 'string', $nin: ['', null] },
    $or: [{ images: { $exists: false } }, { images: { $size: 0 } }],
  }

  const legacy = await Activity.find(filter).select('_id image').lean()

  if (legacy.length === 0) {
    console.log('No legacy single-image activities found — nothing to backfill.')
  } else {
    let updated = 0
    for (const doc of legacy) {
      const image = typeof doc.image === 'string' ? doc.image.trim() : ''
      if (!image) continue
      // $set only — `image` is deliberately left as it is.
      await Activity.updateOne({ _id: doc._id }, { $set: { images: [image] } })
      updated += 1
    }
    console.log(`Copied the legacy image into images[] on ${updated} activity/activities.`)
    console.log('The legacy `image` field was left in place on every document.')
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
