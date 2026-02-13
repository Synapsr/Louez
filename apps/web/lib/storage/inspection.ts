/**
 * Inspection Photo Storage Utilities
 *
 * Helpers for uploading and managing inspection photos
 * using the existing S3/R2 storage infrastructure.
 */

import { nanoid } from 'nanoid'
import { uploadFile, deleteFile, getPublicUrl, getStorageKey } from './client'

/**
 * Generate a unique storage key for an inspection photo
 */
export function getInspectionPhotoKey(
  storeId: string,
  inspectionId: string,
  photoId: string,
  isThumbnail = false
): string {
  const suffix = isThumbnail ? '_thumb' : ''
  return getStorageKey(storeId, 'inspections', inspectionId, `${photoId}${suffix}.webp`)
}

/**
 * Upload an inspection photo
 * Returns both the key and public URL
 */
export async function uploadInspectionPhoto(
  storeId: string,
  inspectionId: string,
  photoBuffer: Buffer | Uint8Array,
  thumbnailBuffer?: Buffer | Uint8Array
): Promise<{
  photoId: string
  photoKey: string
  photoUrl: string
  thumbnailKey: string | null
  thumbnailUrl: string | null
}> {
  const photoId = nanoid()

  // Upload main photo
  const photoKey = getInspectionPhotoKey(storeId, inspectionId, photoId)
  const photoUrl = await uploadFile({
    key: photoKey,
    body: photoBuffer,
    contentType: 'image/webp',
  })

  // Upload thumbnail if provided
  let thumbnailKey: string | null = null
  let thumbnailUrl: string | null = null

  if (thumbnailBuffer) {
    thumbnailKey = getInspectionPhotoKey(storeId, inspectionId, photoId, true)
    thumbnailUrl = await uploadFile({
      key: thumbnailKey,
      body: thumbnailBuffer,
      contentType: 'image/webp',
    })
  }

  return {
    photoId,
    photoKey,
    photoUrl,
    thumbnailKey,
    thumbnailUrl,
  }
}

/**
 * Delete an inspection photo and its thumbnail
 */
export async function deleteInspectionPhoto(
  photoKey: string,
  thumbnailKey?: string | null
): Promise<void> {
  await deleteFile(photoKey)

  if (thumbnailKey) {
    await deleteFile(thumbnailKey)
  }
}

/**
 * Delete all photos for an inspection
 */
export async function deleteInspectionPhotos(
  photos: Array<{ photoKey: string; thumbnailKey: string | null }>
): Promise<void> {
  await Promise.all(
    photos.map((photo) => deleteInspectionPhoto(photo.photoKey, photo.thumbnailKey))
  )
}

/**
 * Get the public URL for an inspection photo
 */
export function getInspectionPhotoUrl(photoKey: string): string {
  return getPublicUrl(photoKey)
}
