const mongoose = require('mongoose')
const Club = require('../models/Club')
const ClubMembership = require('../models/ClubMembership')
const User = require('../models/User')
const AppError = require('../utils/AppError')
const catchAsync = require('../utils/catchAsync')
const { success } = require('../utils/apiResponse')
const { isValidObjectId } = require('../validators/validate')
const { assertManagesClub } = require('../utils/clubAccess')

// Whether a profile carries enough academic info for the club / activity
// system to give other students (and their club) something real to work with.
// Google-login accounts start empty except for name/email, so this is what
// gates joinClub until they fill the profile in.
exports.isProfileComplete = (user) => {
  if (!user) return false
  return Boolean(
    user.phone && String(user.phone).trim() &&
    user.faculty && String(user.faculty).trim() &&
    user.major && String(user.major).trim() &&
    user.year
  )
}

// Joining is immediate — no approval/rejection workflow. The membership
// document is created directly with an active state (its mere existence
// means "active"), and clubs.memberCount is incremented in the same
// transaction to keep the denormalized counter consistent.
exports.joinClub = catchAsync(async (req, res, next) => {
  const clubId = req.params.id
  if (!isValidObjectId(clubId)) return next(new AppError('Invalid club id', 400))

  const student = await User.findById(req.user.id)
  if (!student) return next(new AppError('Account not found', 404))

  if (!exports.isProfileComplete(student)) {
    return next(new AppError('กรุณากรอกข้อมูลส่วนตัวให้ครบ (เบอร์โทรศัพท์, ชั้นปี, คณะ, สาขาวิชา) ก่อนสมัครเข้าร่วมชมรม', 400))
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const club = await Club.findById(clubId).session(session)
    if (!club) throw new AppError('Club not found', 404)

    if (club.memberCount >= club.maxMembers) {
      throw new AppError('Club has reached maximum capacity', 409)
    }

    const existing = await ClubMembership.findOne({ student: req.user.id, club: clubId }).session(session)
    if (existing) {
      throw new AppError('You are already a member of this club', 409)
    }

    const [membership] = await ClubMembership.create(
      [{ student: req.user.id, club: clubId, joinedAt: new Date() }],
      { session }
    )

    club.memberCount += 1
    await club.save({ session })

    await session.commitTransaction()
    success(res, 201, { membership }, 'Joined club successfully')
  } catch (err) {
    await session.abortTransaction()
    next(err)
  } finally {
    session.endSession()
  }
})

exports.leaveClub = catchAsync(async (req, res, next) => {
  const clubId = req.params.id
  if (!isValidObjectId(clubId)) return next(new AppError('Invalid club id', 400))

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const membership = await ClubMembership.findOne({ student: req.user.id, club: clubId }).session(session)
    if (!membership) throw new AppError('Membership not found', 404)

    await ClubMembership.deleteOne({ _id: membership._id }).session(session)

    await Club.updateOne(
      { _id: clubId, memberCount: { $gt: 0 } },
      { $inc: { memberCount: -1 } }
    ).session(session)

    await session.commitTransaction()
    success(res, 200, null, 'Left club successfully')
  } catch (err) {
    await session.abortTransaction()
    next(err)
  } finally {
    session.endSession()
  }
})

exports.getMyClubs = catchAsync(async (req, res, next) => {
  const memberships = await ClubMembership.find({ student: req.user.id })
    .populate('club')
    .sort({ joinedAt: -1 })

  success(res, 200, { memberships })
})

exports.getClubMembers = catchAsync(async (req, res, next) => {
  const clubId = req.params.id
  if (!isValidObjectId(clubId)) return next(new AppError('Invalid club id', 400))

  const club = await Club.findById(clubId)
  if (!club) return next(new AppError('Club not found', 404))

  await assertManagesClub(req.user, clubId)

  const members = await ClubMembership.find({ club: clubId })
    .populate('student', 'firstName lastName studentId email faculty major year')
    .sort({ joinedAt: -1 })

  success(res, 200, { members })
})
