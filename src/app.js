const express = require('express')
const path = require('path')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { FRONTEND_URL } = require('./config/env')
const storage = require('./services/storage.service')
const errorHandler = require('./middleware/errorHandler')

const authRoutes = require('./routes/auth.routes')
const clubRoutes = require('./routes/club.routes')
const activityRoutes = require('./routes/activity.routes')
const adminRoutes = require('./routes/admin.routes')
const studentRoutes = require('./routes/student.routes')
const referenceRoutes = require('./routes/reference.routes')

const app = express()

// Behind nginx/reverse proxy so req.protocol honors X-Forwarded-Proto (used
// to build the Google OAuth redirect URI in production).
app.set('trust proxy', 1)

app.use(cors({ origin: FRONTEND_URL, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// Publicly served uploaded images (clubs/ = club cover images,
// clubs-gallery/ = club photo galleries, activities/ = activity images) —
// same trust level as any other public club or activity data, no auth needed
// to view them.
// Uploading and deleting them is authenticated + role-gated on the API routes.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// Preserve legacy `/uploads/...` paths stored in MongoDB. The local static
// fallback above serves any original files still present on a developer's
// machine; otherwise redirect to the matching object in the public bucket.
app.get('/uploads/*', (req, res, next) => {
  try {
    const objectKey = storage.publicKeyFromLegacyPath(req.path)
    if (!objectKey) return res.status(404).json({ success: false, message: 'File not found' })
    res.redirect(302, storage.getPublicObjectUrl(objectKey))
  } catch (error) {
    next(error)
  }
})

app.get('/api/health', (req, res) => res.json({ success: true, message: 'OK' }))

app.use('/api/auth', authRoutes)
app.use('/api/clubs', clubRoutes)
app.use('/api/activities', activityRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/reference-data', referenceRoutes)

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

app.use(errorHandler)

module.exports = app
