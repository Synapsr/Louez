import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reservations, stores } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateContract, getContractPdfBuffer } from '@/lib/pdf/generate'
import { getCustomerSession } from '../../../actions'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; reservationId: string }> }
) {
  const { slug, reservationId } = await params

  // Get store
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return new NextResponse('Store not found', { status: 404 })
  }

  // Verify customer session
  const session = await getCustomerSession(slug)

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Get reservation and verify it belongs to the customer
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId)
    ),
    with: {
      documents: true,
    },
  })

  if (!reservation) {
    return new NextResponse('Reservation not found', { status: 404 })
  }

  // Only allow contract download for confirmed/ongoing/completed reservations
  if (!['confirmed', 'ongoing', 'completed'].includes(reservation.status)) {
    return new NextResponse('Contract not available for this status', { status: 400 })
  }

  // Check if contract exists, if not generate it
  let contract = reservation.documents.find((d) => d.type === 'contract')

  if (!contract) {
    contract = await generateContract({ reservationId })
    if (!contract) {
      return new NextResponse('Failed to generate contract', { status: 500 })
    }
  }

  // Get PDF buffer
  const pdfBuffer = await getContractPdfBuffer(reservationId)

  if (!pdfBuffer) {
    return new NextResponse('Contract file not found', { status: 404 })
  }

  // Return PDF
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${contract.fileName}"`,
    },
  })
}
