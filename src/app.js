const express = require('express')
const path = require('path')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { FRONTEND_URL } = require('./config/env')
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

// Publicly served uploaded club images — same trust level as any other
// public club data, no auth needed to view them.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

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
