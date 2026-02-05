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
 * Maximum image size in bytes (15MB)
 */
export const MAX_IMAGE_SIZE = 15 * 1024 * 1024

/**
 * Maximum data URI length (roughly 20MB to account for base64 encoding overhead)
 * Base64 increases size by ~33%, so 15MB image → ~20MB data URI
 */
export const MAX_DATA_URI_LENGTH = 20 * 1024 * 1024

/**
 * Maximum logo size in bytes (2MB - logos should be smaller)
 */
export const MAX_LOGO_SIZE = 2 * 1024 * 1024

/**
 * Maximum hero image size in bytes (5MB)
 */
export const MAX_HERO_SIZE = 5 * 1024 * 1024

/**
 * Pattern to extract MIME type from data URI
 * Captures: data:image/png;base64,... → image/png
 */
const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|jpg|png|gif|webp|svg\+xml));base64,/i

/**
 * Client-safe image URL validation for use in browser-side Zod schemas.
 * Does NOT depend on server-only env variables (S3_PUBLIC_URL).
 *
 * Accepts:
 * - Empty string (optional field)
 * - Any valid HTTP(S) URL (the upload API already ensures S3 URLs)
 *
 * Rejects:
 * - Data URIs (base64) — images must be uploaded to S3
 * - Invalid URLs
 *
 * NOTE: This is a UX-level check. The server action re-validates with
 * isValidImageUrl() which enforces the strict S3 origin check.
 */
export function isValidImageUrlClient(url: string): boolean {
  if (!url || url === '') return true

  // SECURITY: Reject data URIs — must be uploaded to S3
  if (url.startsWith('data:')) return false

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Validates that a URL is a secure image URL stored in S3
 * SECURITY: Base64 data URIs are NOT allowed - images must be uploaded to S3
 * Accepts:
 * - URLs from our S3 bucket (S3_PUBLIC_URL)
 * - Empty string (optional field)
 */
export function isValidImageUrl(url: string): boolean {
  // Empty is valid (optional)
  if (!url || url === '') return true

  // SECURITY: Reject data URIs (base64) - must be uploaded to S3
  if (url.startsWith('data:')) {
    return false
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
 * SECURITY: Only accepts S3 URLs - base64 data URIs are rejected
 * Accepts empty string or S3 URLs only
 */
export const imageUrlSchema = z
  .string()
  .refine(
    (val) => {
      if (!val || val === '') return true
      return isValidImageUrl(val)
    },
    {
      message: 'Invalid image URL. Base64 images are not allowed. Please upload to S3.',
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
 * SECURITY: Only S3 URLs are allowed for storage - base64 data URIs are rejected
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

  // SECURITY: Reject data URIs (base64) - must be uploaded to S3
  if (url.startsWith('data:')) {
    return {
      valid: false,
      error: 'Base64 images are not allowed. Please upload images to S3.',
      sanitized: '',
    }
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
