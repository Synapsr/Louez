import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Validation schema for appearance data
const appearanceSchema = z.object({
  logoUrl: z.union([
    z.string().url(),
    z.string().startsWith('data:image/'), // Allow base64 images
    z.null(),
  ]).optional(),
  theme: z.object({
    mode: z.enum(['light', 'dark']),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color'),
    heroImages: z.array(
      z.union([
        z.string().url(),
        z.string().startsWith('data:image/'),
      ])
    ).max(5).optional(),
  }).optional(),
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
