require('dotenv').config()

const required = ['MONGODB_URI', 'JWT_SECRET']

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // --- Google OAuth (direct Google sign-in) ---
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  // Optional; defaults to <backend>/api/auth/google/callback derived from the
  // request, so the same callback works locally and behind a proxy.
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PUBLIC_BUCKET: process.env.SUPABASE_PUBLIC_BUCKET || 'projectclue-public',
  SUPABASE_PRIVATE_BUCKET: process.env.SUPABASE_PRIVATE_BUCKET || 'projectclue-private',
}
