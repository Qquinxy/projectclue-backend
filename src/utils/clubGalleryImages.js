const fs = require('fs/promises')
const path = require('path')
const { CLUB_GALLERY_DIR } = require('../middleware/upload')

// Public URL prefix that `express.static('/uploads', ...)` in app.js serves
// club GALLERY photos from.
//
// Deliberately distinct from "/uploads/clubs/" (the club cover image) and
// "/uploads/activities/" (activity images), so a gallery operation can never
// reach a cover image or an activity image even if a client asks it to.
const CLUB_GALLERY_PREFIX = '/uploads/clubs-gallery/'

exports.CLUB_GALLERY_PREFIX = CLUB_GALLERY_PREFIX

// Path stored on the club for a file multer just wrote. multer generates the
// name (a UUID + an extension derived from the MIME type), so the client's
// original filename never reaches the filesystem.
exports.toPublicPath = (filename) => `${CLUB_GALLERY_PREFIX}${filename}`

// Best-effort removal of the file backing a stored gallery photo.
//
// Only gallery files are ever touched: the value must start with
// "/uploads/clubs-gallery/", and the resolved location must still sit inside
// CLUB_GALLERY_DIR. That means:
//   - "/uploads/clubs/cover.jpg"            -> ignored (a club cover image)
//   - "/uploads/activities/photo.jpg"       -> ignored (an activity image)
//   - "/uploads/clubs-gallery/../x"         -> ignored (path traversal)
//   - "https://example.com/photo.jpg"       -> ignored (external URL)
// so deleting a gallery photo can never remove a cover, an activity image, or
// anything outside the gallery directory.
//
// A missing file is not an error: the reference is being removed anyway.
exports.removeClubGalleryFile = async (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith(CLUB_GALLERY_PREFIX)) return

  const filename = imagePath.slice(CLUB_GALLERY_PREFIX.length)
  if (!filename || filename.includes('\0')) return

  const resolved = path.resolve(CLUB_GALLERY_DIR, filename)
  const root = path.resolve(CLUB_GALLERY_DIR) + path.sep
  if (!resolved.startsWith(root)) return

  try {
    await fs.unlink(resolved)
  } catch (err) {
    // ENOENT: already gone. Anything else (permissions, read-only mount) must
    // not fail the request — the reference removal is what the caller asked
    // for, and an orphaned file is harmless.
    if (err.code !== 'ENOENT') {
      console.error(`Failed to remove club gallery file ${resolved}:`, err.message)
    }
  }
}

// The gallery of a club document. A plain read of `galleryImages` — there is
// deliberately NO fallback to the cover image: an empty gallery stays empty.
exports.resolveGalleryImages = (club) => {
  if (!club || !Array.isArray(club.galleryImages)) return []
  return club.galleryImages.filter((src) => typeof src === 'string' && src.trim() !== '')
}
