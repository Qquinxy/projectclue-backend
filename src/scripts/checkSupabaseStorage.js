require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const PUBLIC_BUCKET = 'projectclue-public'
const PRIVATE_BUCKET = 'projectclue-private'
const TARGET_PUBLIC_OBJECT = 'activities/d7f9221a-2963-4c72-a370-4004a818bb7a.jpg'
const PAGE_SIZE = 1000

const safeErrorDetails = (error) => ({
  status: error?.statusCode ?? error?.status ?? null,
  code: typeof error?.code === 'string' ? error.code : null,
})

async function listBucketFiles(client, bucket) {
  const files = []
  const visitedFolders = new Set()

  async function walk(folder) {
    if (visitedFolders.has(folder)) return
    visitedFolders.add(folder)

    const folders = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.storage.from(bucket).list(folder, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw error

      const entries = data || []
      for (const entry of entries) {
        const objectPath = folder ? `${folder}/${entry.name}` : entry.name
        if (entry.id === null && entry.metadata === null) folders.push(objectPath)
        else files.push(objectPath)
      }
      if (entries.length < PAGE_SIZE) break
    }

    for (const childFolder of folders) await walk(childFolder)
  }

  await walk('')
  return files.sort((a, b) => a.localeCompare(b))
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase connection: NOT CONFIGURED (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)')
    process.exitCode = 1
    return
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { data: buckets, error } = await client.storage.listBuckets()
    if (error) throw error
    console.log('Supabase connection: OK')

    const availableBuckets = new Set((buckets || []).map((bucket) => bucket.name))
    const counts = { [PUBLIC_BUCKET]: 0, [PRIVATE_BUCKET]: 0 }
    for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
      if (!availableBuckets.has(bucket)) {
        console.log(`Bucket ${bucket}: NOT FOUND`)
        if (bucket === PUBLIC_BUCKET) console.log(`Target ${TARGET_PUBLIC_OBJECT}: NOT FOUND`)
        continue
      }

      const files = await listBucketFiles(client, bucket)
      counts[bucket] = files.length
      console.log(`Bucket ${bucket}: FOUND; ${files.length} file(s)`)
      for (const file of files) console.log(`  ${file}`)

      if (bucket === PUBLIC_BUCKET) {
        console.log(`Target ${TARGET_PUBLIC_OBJECT}: ${files.includes(TARGET_PUBLIC_OBJECT) ? 'FOUND' : 'NOT FOUND'}`)
      }
    }
    console.log(`Summary: ${counts[PUBLIC_BUCKET] + counts[PRIVATE_BUCKET]} file(s) total; ${PUBLIC_BUCKET}=${counts[PUBLIC_BUCKET]}, ${PRIVATE_BUCKET}=${counts[PRIVATE_BUCKET]}`)
  } catch (error) {
    console.error('Supabase Storage check: FAILED', JSON.stringify(safeErrorDetails(error)))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('Supabase Storage check: FAILED', JSON.stringify(safeErrorDetails(error)))
  process.exitCode = 1
})
