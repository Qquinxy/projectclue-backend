const mongoose = require('mongoose')

// Selectable reference values for the profile "academic info" fields —
// faculties, academic years and majors. `value` is what users' profiles
// store; `label` is what the UI displays (defaults to the value). Values are
// unique per type so the profile selects stay deterministic.
const referenceDataSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['faculty', 'year', 'major'] },
    value: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
)

referenceDataSchema.index({ type: 1, value: 1 }, { unique: true })
referenceDataSchema.index({ type: 1, sortOrder: 1, value: 1 })

module.exports = mongoose.model('ReferenceData', referenceDataSchema)