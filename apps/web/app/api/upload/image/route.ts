import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { storeMembers } from '@louez/db'
import { eq } from 'drizzle-orm'
import { uploadFile, getStorageKey, deleteFile } from '@/lib/storage/client'
import { nanoid } from 'nanoid'
import {
  validateDataUri,
  extractBase64,
  estimateBase64Size,
  MAX_IMAGE_SIZE,
  MAX_LOGO_SIZE,
  MAX_HERO_SIZE,
  type AllowedImageType,
} from '@louez/validations'

// ===== Constants =====

const MIME_TO_EXT: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const UPLOAD_TYPES = ['logo', 'hero', 'product'] as const
type UploadType = (typeof UPLOAD_TYPES)[number]

// Size limits per type
const SIZE_LIMITS: Record<UploadType, number> = {
  logo: MAX_LOGO_SIZE,     // 2MB
  hero: MAX_HERO_SIZE,     // 5MB
  product: MAX_IMAGE_SIZE, // 15MB
}

// ===== Validation Schemas =====

const uploadRequestSchema = z.object({
  image: z.string().min(1, 'Image data is required'),
  type: z.enum(['logo', 'hero', 'product']),
  storeId: z.string().length(21).optional(),
  filename: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Filename can only contain letters, numbers, dashes, and underscores')
    .optional(),
})

const deleteRequestSchema = z.object({
  key: z
    .string()
    .min(1, 'Key is required')
    .regex(
      /^[a-zA-Z0-9_-]{21}\/(?:logo|products|documents)\/[a-zA-Z0-9_.-]+$/,
      'Invalid storage key format'
    ),
})

// ===== Helpers =====

/**
 * Sanitizes a filename to prevent path traversal and other attacks
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, '') // Prevent path traversal
    .replace(/[^a-zA-Z0-9_-]/g, '') // Only allow safe characters
    .slice(0, 50) // Limit length
}

/**
 * Returns a formatted error message for file size limits
 */
function formatSizeLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}MB`
  }
  return `${Math.round(bytes / 1024)}KB`
}

// ===== Route Handlers =====

/**
 * POST /api/upload/image
 *
 * Uploads a base64-encoded image to S3 storage.
 * Returns the public URL of the uploaded image.
 *
 * Security measures:
 * - Authentication required
 * - Store membership verification
 * - MIME type validation (whitelist)
 * - File size limits per type
 * - Filename sanitization
 * - Unique file naming to prevent overwrites
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'errors.unauthorized' },
        { status: 401 }
      )
    }

    // 2. Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = uploadRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'errors.invalidData' },
        { status: 400 }
      )
    }

    const { image, type, storeId: requestedStoreId, filename } = parsed.data

    // 3. Validate image data URI (MIME type whitelist)
    const mimeType = validateDataUri(image)
    if (!mimeType) {
      return NextResponse.json(
        { error: 'Invalid image format. Allowed: JPEG, PNG, GIF, WebP, SVG' },
        { status: 400 }
      )
    }

    // 4. Extract and validate base64 data
    const base64Data = extractBase64(image)
    if (!base64Data) {
      return NextResponse.json(
        { error: 'Invalid base64 data' },
        { status: 400 }
      )
    }

    // 5. Validate file size based on type
    const fileSize = estimateBase64Size(base64Data)
    const maxSize = SIZE_LIMITS[type]
    if (fileSize > maxSize) {
      return NextResponse.json(
        { error: `Image too large. Maximum size for ${type} is ${formatSizeLimit(maxSize)}.` },
        { status: 400 }
      )
    }

    // 6. Get user's store membership and verify access
    const membership = await db.query.storeMembers.findFirst({
      where: eq(storeMembers.userId, session.user.id),
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'No store found for user' },
        { status: 404 }
      )
    }

    // Determine target store
    let targetStoreId = membership.storeId

    // If a specific storeId was requested, verify access
    if (requestedStoreId && requestedStoreId !== membership.storeId) {
      const userMemberships = await db.query.storeMembers.findMany({
        where: eq(storeMembers.userId, session.user.id),
      })

      const hasAccess = userMemberships.some(
        (m: { storeId: string }) => m.storeId === requestedStoreId
      )
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Access denied to this store' },
          { status: 403 }
        )
      }

      targetStoreId = requestedStoreId
    }

    // 7. Generate secure storage key
    const extension = MIME_TO_EXT[mimeType] || 'jpg'
    const uniqueId = nanoid(10)
    const sanitizedFilename = filename ? sanitizeFilename(filename) : type
    const finalFilename = `${sanitizedFilename}-${uniqueId}.${extension}`

    // Map type to storage folder
    const storageType = type === 'product' ? 'products' : 'logo'
    const key = getStorageKey(targetStoreId, storageType, finalFilename)

    // 8. Upload to S3
    const buffer = Buffer.from(base64Data, 'base64')
    const url = await uploadFile({
      key,
      body: buffer,
      contentType: mimeType,
    })

    // 9. Return success response
    return NextResponse.json({
      url,
      key,
      filename: finalFilename,
      size: fileSize,
      mimeType,
    })
  } catch (error) {
    console.error('[Upload] Image upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/upload/image
 *
 * Deletes an image from S3 storage.
 *
 * Security measures:
 * - Authentication required
 * - Store ownership verification via key parsing
 * - Key format validation
 */
export async function DELETE(request: NextRequest) {
  try {
    // 1. Authentication
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'errors.unauthorized' },
        { status: 401 }
      )
    }

    // 2. Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = deleteRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'errors.invalidData' },
        { status: 400 }
      )
    }

    const { key } = parsed.data

    // 3. Extract storeId from key and verify access
    const storeId = key.split('/')[0]
    if (!storeId || storeId.length !== 21) {
      return NextResponse.json(
        { error: 'Invalid storage key' },
        { status: 400 }
      )
    }

    // 4. Verify user has access to this store
    const userMemberships = await db.query.storeMembers.findMany({
      where: eq(storeMembers.userId, session.user.id),
    })

    const hasAccess = userMemberships.some(
      (m: { storeId: string }) => m.storeId === storeId
    )
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // 5. Delete from S3
    await deleteFile(key)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Upload] Image delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    )
  }
}
