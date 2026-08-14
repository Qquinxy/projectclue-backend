// Bootstraps the first superadmin account. There is no HTTP endpoint for
// creating a superadmin (registration always defaults to role "student",
// and /api/admin/users only creates club_admin accounts), so this CLI
// script is the only way to promote/create a superadmin user.
//
// Usage:
//   npm run seed:admin -- <email> <password> <studentId> <firstName> <lastName>
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { MONGODB_URI } = require('../config/env')
const User = require('../models/User')

const run = async () => {
  const [, , email, password, studentId, firstName, lastName] = process.argv

  if (!email || !password || !studentId || !firstName || !lastName) {
    console.log('Usage: npm run seed:admin -- <email> <password> <studentId> <firstName> <lastName>')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) {
    existing.role = 'superadmin'
    await existing.save()
    console.log(`Existing user ${email} promoted to superadmin`)
  } else {
    const passwordHash = await bcrypt.hash(password, 12)
    await User.create({
      studentId,
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash,
      role: 'superadmin',
      faculty: '-',
      major: '-',
      year: 0,
    })
    console.log(`Superadmin user ${email} created`)
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
