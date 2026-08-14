const mongoose = require('mongoose')

const clubMembershipSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  joinedAt: { type: Date, default: Date.now },
})

// Membership is binary: document existence means active membership.
// No status, role, reviewedBy, or reviewedAt fields — approval/rejection is out of scope.
clubMembershipSchema.index({ student: 1, club: 1 }, { unique: true })

module.exports = mongoose.model('ClubMembership', clubMembershipSchema)
