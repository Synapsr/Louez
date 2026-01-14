import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Validation schema for legal pages
const legalSchema = z.object({
  cgv: z.string().max(100000, 'CGV trop longues').optional(),
  legalNotice: z.string().max(100000, 'Mentions legales trop longues').optional(),
})

export async function PATCH(request: Request) {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Validate input with Zod
    const validated = legalSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { cgv, legalNotice } = validated.data

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (cgv !== undefined) {
      updateData.cgv = cgv
    }

    if (legalNotice !== undefined) {
      updateData.legalNotice = legalNotice
    }

    await db.update(stores).set(updateData).where(eq(stores.id, store.id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating legal pages:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
