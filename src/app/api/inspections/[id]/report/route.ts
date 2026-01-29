import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { inspections, reservations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getInspectionReportPdfBuffer } from '@/lib/pdf/generate-inspection'
import type { SupportedLocale } from '@/lib/pdf/inspection-report'

// Parse Accept-Language header to determine preferred locale
function getPreferredLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) {
    return 'fr'
  }

  const languages = acceptLanguage
    .split(',')
    .map((lang) => {
      const [code, quality = 'q=1'] = lang.trim().split(';')
      const q = parseFloat(quality.replace('q=', '')) || 1
      return { code: code.toLowerCase().split('-')[0], q }
    })
    .sort((a, b) => b.q - a.q)

  for (const { code } of languages) {
    if (code === 'en') return 'en'
    if (code === 'fr') return 'fr'
  }

  return 'fr'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params

  // Get store for user
  const store = await getCurrentStore()

  if (!store) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Get inspection
  const inspection = await db.query.inspections.findFirst({
    where: eq(inspections.id, inspectionId),
  })

  if (!inspection) {
    return new NextResponse('Inspection not found', { status: 404 })
  }

  // Verify the inspection belongs to a reservation of this store
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, inspection.reservationId),
      eq(reservations.storeId, store.id)
    ),
  })

  if (!reservation) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Detect language from query parameter or Accept-Language header
  const url = new URL(request.url)
  const langParam = url.searchParams.get('lang')

  let locale: SupportedLocale
  if (langParam === 'en' || langParam === 'fr') {
    locale = langParam
  } else {
    const acceptLanguage = request.headers.get('Accept-Language')
    locale = getPreferredLocale(acceptLanguage)
  }

  // Generate PDF
  const result = await getInspectionReportPdfBuffer(inspectionId, locale)

  if (!result) {
    return new NextResponse('Failed to generate inspection report', { status: 500 })
  }

  // Return PDF
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Content-Language': locale,
    },
  })
}
