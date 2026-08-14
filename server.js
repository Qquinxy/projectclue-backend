const connectDB = require('./src/config/db')
const { PORT } = require('./src/config/env')
const app = require('./src/app')

const start = async () => {
  await connectDB()
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
