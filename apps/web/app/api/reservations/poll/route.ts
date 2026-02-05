import { NextResponse } from 'next/server'
import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations } from '@louez/db'
import { eq, and, desc, count } from 'drizzle-orm'

export async function GET() {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get pending count
    const pendingResult = await db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, store.id),
          eq(reservations.status, 'pending')
        )
      )

    // Get latest reservation ID and timestamp
    const latestReservation = await db.query.reservations.findFirst({
      where: eq(reservations.storeId, store.id),
      orderBy: [desc(reservations.createdAt)],
      columns: {
        id: true,
        createdAt: true,
        status: true,
        number: true,
      },
    })

    // Get total count of all reservations
    const totalResult = await db
      .select({ count: count() })
      .from(reservations)
      .where(eq(reservations.storeId, store.id))

    return NextResponse.json({
      pendingCount: pendingResult[0]?.count || 0,
      totalCount: totalResult[0]?.count || 0,
      latestReservation: latestReservation
        ? {
            id: latestReservation.id,
            number: latestReservation.number,
            status: latestReservation.status,
            createdAt: latestReservation.createdAt.toISOString(),
          }
        : null,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error polling reservations:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
