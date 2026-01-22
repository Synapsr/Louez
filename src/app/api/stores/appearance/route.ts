import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isValidImageUrl } from '@/lib/validations/image'

// SECURITY: Only allow S3 URLs, block base64 data URIs
const s3UrlSchema = z
  .string()
  .refine(
    (url) => !url.startsWith('data:'),
    'Base64 images are not allowed. Please upload images to S3.'
  )
  .refine(
    (url) => isValidImageUrl(url),
    'Invalid image URL. Must be a valid S3 URL.'
  )

// Validation schema for appearance data
const appearanceSchema = z.object({
  logoUrl: z.union([s3UrlSchema, z.literal(''), z.null()]).optional(),
  theme: z
    .object({
      mode: z.enum(['light', 'dark']),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color'),
      heroImages: z.array(s3UrlSchema).max(5).optional(),
    })
    .optional(),
})

export async function PATCH(request: Request) {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Validate input with Zod
    const validated = appearanceSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { logoUrl, theme } = validated.data

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (logoUrl !== undefined) {
      updateData.logoUrl = logoUrl
    }

    if (theme) {
      updateData.theme = theme
    }

    await db.update(stores).set(updateData).where(eq(stores.id, store.id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating store appearance:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
