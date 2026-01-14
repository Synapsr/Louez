import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { reservations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateContract } from '@/lib/pdf/generate'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reservationId } = await params

  // Get client IP
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             headersList.get('x-real-ip') ||
             'unknown'

  // Get reservation
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
  })

  if (!reservation) {
    return NextResponse.json(
      { error: 'Reservation not found' },
      { status: 404 }
    )
  }

  // Check if already signed
  if (reservation.signedAt) {
    return NextResponse.json(
      { error: 'Contract already signed' },
      { status: 400 }
    )
  }

  // Update reservation with signature
  await db
    .update(reservations)
    .set({
      signedAt: new Date(),
      signatureIp: ip,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  // Regenerate contract PDF with signature
  await generateContract({ reservationId, regenerate: true })

  return NextResponse.json({ success: true })
}
