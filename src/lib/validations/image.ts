import { z } from 'zod'

// ===== IMAGE VALIDATION =====
// Validates image URLs and data URIs to prevent malicious uploads

/**
 * Allowed image MIME types
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

/**
 * Maximum image size in bytes (5MB)
 */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * Maximum data URI length (roughly 7MB to account for base64 encoding overhead)
 * Base64 increases size by ~33%, so 5MB image → ~6.7MB data URI
 */
export const MAX_DATA_URI_LENGTH = 7 * 1024 * 1024

/**
 * Pattern to extract MIME type from data URI
 * Captures: data:image/png;base64,... → image/png
 */
const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|jpg|png|gif|webp|svg\+xml));base64,/i

/**
 * Validates that a URL is a secure image URL
 * Accepts:
 * - Data URIs with allowed image types
 * - URLs from our S3 bucket (S3_PUBLIC_URL)
 * - Empty string (optional field)
 */
export function isValidImageUrl(url: string): boolean {
  // Empty is valid (optional)
  if (!url || url === '') return true

  // Check for data URI
  if (url.startsWith('data:')) {
    // Validate MIME type
    const match = url.match(DATA_URI_PATTERN)
    if (!match) {
      return false
    }

    // Check size (data URIs can be very large)
    if (url.length > MAX_DATA_URI_LENGTH) {
      return false
    }

    return true
  }

  // Check for S3 URLs
  const s3PublicUrl = process.env.S3_PUBLIC_URL
  if (s3PublicUrl && url.startsWith(s3PublicUrl)) {
    // Validate URL format and extension
    try {
      const parsed = new URL(url)
      const pathname = parsed.pathname.toLowerCase()
      // Validate image extension using regex for stricter matching
      // Ensures extension is at the end of the filename (not followed by other characters)
      const imageExtRegex = /\.(jpg|jpeg|png|gif|webp|svg)$/i
      return imageExtRegex.test(pathname)
    } catch {
      return false
    }
  }

  // For development, also allow localhost URLs
  if (process.env.NODE_ENV === 'development') {
    try {
      const parsed = new URL(url)
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return true
      }
    } catch {
      // Invalid URL
    }
  }

  // Reject all other URLs
  return false
}

/**
 * Validates that a data URI contains a valid image
 * Returns the detected MIME type or null if invalid
 */
export function validateDataUri(dataUri: string): AllowedImageType | null {
  const match = dataUri.match(DATA_URI_PATTERN)
  if (!match) return null

  const mimeType = match[1].toLowerCase() as AllowedImageType

  // Normalize jpg to jpeg
  if (mimeType === 'image/jpg') {
    return 'image/jpeg'
  }

  if (!ALLOWED_IMAGE_TYPES.includes(mimeType as AllowedImageType)) {
    return null
  }

  return mimeType as AllowedImageType
}

/**
 * Extracts the base64 data from a data URI
 */
export function extractBase64(dataUri: string): string | null {
  const commaIndex = dataUri.indexOf(',')
  if (commaIndex === -1) return null
  return dataUri.slice(commaIndex + 1)
}

/**
 * Estimates the decoded size of a base64 string
 */
export function estimateBase64Size(base64: string): number {
  // Remove padding characters
  const padding = (base64.match(/=/g) || []).length
  // Base64 encodes 3 bytes in 4 characters
  return Math.floor((base64.length * 3) / 4) - padding
}

/**
 * Validates and sanitizes an image URL
 * Returns the URL if valid, empty string otherwise
 */
export function sanitizeImageUrl(url: string | undefined | null): string {
  if (!url) return ''
  if (isValidImageUrl(url)) return url
  return ''
}

// ===== ZOD SCHEMAS =====

/**
 * Zod schema for validating image URLs (logo, product images)
 * Accepts empty string, data URIs, or S3 URLs
 */
export const imageUrlSchema = z
  .string()
  .refine(
    (val) => {
      if (!val || val === '') return true
      return isValidImageUrl(val)
    },
    {
      message: 'Invalid image URL. Must be a valid data URI or uploaded file.',
    }
  )
  .transform((val) => sanitizeImageUrl(val))

/**
 * Zod schema for validating an array of image URLs
 */
export const imageUrlArraySchema = z
  .array(z.string())
  .transform((urls) => urls.filter((url) => isValidImageUrl(url)))
  .refine((urls) => urls.length <= 10, {
    message: 'Maximum 10 images allowed',
  })

/**
 * Validates image data before storage
 * Use this on the server side before saving to DB
 */
export function validateImageForStorage(url: string): {
  valid: boolean
  error?: string
  sanitized: string
} {
  if (!url || url === '') {
    return { valid: true, sanitized: '' }
  }

  // Data URI validation
  if (url.startsWith('data:')) {
    const mimeType = validateDataUri(url)
    if (!mimeType) {
      return {
        valid: false,
        error: 'Invalid image type. Allowed: JPEG, PNG, GIF, WebP, SVG',
        sanitized: '',
      }
    }

    if (url.length > MAX_DATA_URI_LENGTH) {
      return {
        valid: false,
        error: 'Image too large. Maximum size is 5MB.',
        sanitized: '',
      }
    }

    // Validate actual size
    const base64 = extractBase64(url)
    if (base64 && estimateBase64Size(base64) > MAX_IMAGE_SIZE) {
      return {
        valid: false,
        error: 'Image too large. Maximum size is 5MB.',
        sanitized: '',
      }
    }

    return { valid: true, sanitized: url }
  }

  // S3 URL validation
  if (isValidImageUrl(url)) {
    return { valid: true, sanitized: url }
  }

  return {
    valid: false,
    error: 'Invalid image URL. Images must be uploaded through our system.',
    sanitized: '',
  }
}
