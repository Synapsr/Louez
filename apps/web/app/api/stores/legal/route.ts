import { updateStoreLegal } from '@louez/api/services'
import { updateStoreLegalInputSchema } from '@louez/validations'
import { NextResponse } from 'next/server'
import { getCurrentStore } from '@/lib/store-context'

export async function PATCH(request: Request) {
  try {
    const store = await getCurrentStore()
    if (!store) {
      return NextResponse.json({ error: 'errors.unauthenticated' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = updateStoreLegalInputSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'errors.invalidData' }, { status: 400 })
    }

    return NextResponse.json(
      await updateStoreLegal({
        storeId: store.id,
        input: parsed.data,
      }),
    )
  } catch (error) {
    console.error('Update legal pages error:', error)
    return NextResponse.json({ error: 'errors.internalServerError' }, { status: 500 })
  }
}
