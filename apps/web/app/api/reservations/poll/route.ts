import { getReservationPollData } from '@louez/api/services'
import { NextResponse } from 'next/server'
import { getCurrentStore } from '@/lib/store-context'

export async function GET() {
  try {
    const store = await getCurrentStore()
    if (!store) {
      return NextResponse.json({ error: 'errors.unauthenticated' }, { status: 401 })
    }

    return NextResponse.json(
      await getReservationPollData({
        storeId: store.id,
      }),
    )
  } catch (error) {
    console.error('Reservation poll error:', error)
    return NextResponse.json(
      { error: 'errors.internalServerError' },
      { status: 500 },
    )
  }
}
