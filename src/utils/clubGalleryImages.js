const path = require('path')
const storage = require('../services/storage.service')

const CLUB_GALLERY_PREFIX = '/uploads/clubs-gallery/'
exports.CLUB_GALLERY_PREFIX = CLUB_GALLERY_PREFIX
exports.toPublicPath = (filename) => `${CLUB_GALLERY_PREFIX}${filename}`

// Only remove a single object inside the club gallery prefix. Local originals
// remain untouched so they can be copied safely during the storage migration.
exports.removeClubGalleryFile = async (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith(CLUB_GALLERY_PREFIX)) return
  const filename = imagePath.slice(CLUB_GALLERY_PREFIX.length)
  if (!filename || path.posix.basename(filename) !== filename) return
  try {
    await storage.removePublicObject(`clubs-gallery/${filename}`)
  } catch (error) {
    console.error(`Failed to remove club gallery object ${filename}:`, error.message)
  }
}

exports.resolveGalleryImages = (club) => {
  if (!club || !Array.isArray(club.galleryImages)) return []
  return club.galleryImages.filter((src) => typeof src === 'string' && src.trim() !== '')
}
