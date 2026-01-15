import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reservations, stores } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateContract, getContractPdfBuffer } from '@/lib/pdf/generate'
import { getCustomerSession } from '../../../actions'
import type { SupportedLocale } from '@/lib/pdf/contract'

// Parse Accept-Language header to determine preferred locale
function getPreferredLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) {
    return 'fr' // Default to French
  }

  // Parse Accept-Language header (e.g., "en-US,en;q=0.9,fr;q=0.8")
  const languages = acceptLanguage
    .split(',')
    .map((lang) => {
      const [code, quality = 'q=1'] = lang.trim().split(';')
      const q = parseFloat(quality.replace('q=', '')) || 1
      return { code: code.toLowerCase().split('-')[0], q }
    })
    .sort((a, b) => b.q - a.q)

  // Find first supported language
  for (const { code } of languages) {
    if (code === 'en') return 'en'
    if (code === 'fr') return 'fr'
  }

  return 'fr' // Default to French if no supported language found
}

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

  // Detect language from Accept-Language header or query parameter
  const url = new URL(request.url)
  const langParam = url.searchParams.get('lang')

  let locale: SupportedLocale
  if (langParam === 'en' || langParam === 'fr') {
    locale = langParam
  } else {
    const acceptLanguage = request.headers.get('Accept-Language')
    locale = getPreferredLocale(acceptLanguage)
  }

  // Always regenerate contract to ensure latest data with correct locale
  const contract = await generateContract({ reservationId, regenerate: true, locale })
  if (!contract) {
    return new NextResponse('Failed to generate contract', { status: 500 })
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
      'Content-Language': locale,
    },
  })
}
