const Club = require('../models/Club')
const Activity = require('../models/Activity')
const ClubMembership = require('../models/ClubMembership')
const User = require('../models/User')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { hasSuperadminPowers } = require('../utils/adminAccess')

exports.getStats = catchAsync(async (req, res, next) => {
  // A verified Super Admin-equivalent club_admin sees system-wide counts,
  // exactly like a superadmin.
  if (await hasSuperadminPowers(req.user)) {
    const [totalClubs, totalActivities, totalMembers, upcomingActivities] = await Promise.all([
      Club.countDocuments(),
      Activity.countDocuments(),
      ClubMembership.countDocuments(),
      Activity.countDocuments({ status: 'upcoming' }),
    ])

    return success(res, 200, {
      clubs: totalClubs,
      activities: totalActivities,
      members: totalMembers,
      upcomingActivities,
    })
  }

  // club_admin: every count is scoped to their managedClubs.
  const admin = await User.findById(req.user.id).select('managedClubs')
  const managedClubIds = admin?.managedClubs || []

  const [totalClubs, totalActivities, totalMembers, upcomingActivities] = await Promise.all([
    Club.countDocuments({ _id: { $in: managedClubIds } }),
    Activity.countDocuments({ club: { $in: managedClubIds } }),
    ClubMembership.countDocuments({ club: { $in: managedClubIds } }),
    Activity.countDocuments({ club: { $in: managedClubIds }, status: 'upcoming' }),
  ])

  success(res, 200, {
    clubs: totalClubs,
    activities: totalActivities,
    members: totalMembers,
    upcomingActivities,
  })
})
