import { renderToBuffer } from '@react-pdf/renderer'
import {
  InspectionReportDocument,
  InspectionTranslations,
  SupportedLocale,
  defaultTranslationsFr,
  defaultTranslationsEn,
} from './inspection-report'
import { db } from '@louez/db'
import {
  inspections,
  inspectionItems,
  inspectionPhotos,
  reservations,
  stores,
  customers,
  users,
} from '@louez/db'
import { eq, and, sql, desc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { convertImageForPdf } from './image-utils'
import { getLogoForLightBackground } from '@louez/utils'
import type { ConditionRating } from '@louez/types'

interface GenerateInspectionReportOptions {
  inspectionId: string
  regenerate?: boolean
  locale?: SupportedLocale
}

// Get translations for the specified locale
function getTranslations(locale: SupportedLocale): InspectionTranslations {
  return locale === 'fr' ? defaultTranslationsFr : defaultTranslationsEn
}

export async function generateInspectionReport({
  inspectionId,
  regenerate = false,
  locale = 'fr',
}: GenerateInspectionReportOptions) {
  // Get inspection with items
  const inspection = await db.query.inspections.findFirst({
    where: eq(inspections.id, inspectionId),
  })

  if (!inspection) {
    throw new Error('Inspection not found')
  }

  // Get reservation
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, inspection.reservationId),
  })

  if (!reservation) {
    throw new Error('Reservation not found')
  }

  // Get store
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, reservation.storeId),
  })

  if (!store) {
    throw new Error('Store not found')
  }

  // Get customer
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, reservation.customerId),
  })

  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : 'Client'

  // Get performer name if available
  let performedByName: string | null = null
  if (inspection.performedById) {
    const performer = await db.query.users.findFirst({
      where: eq(users.id, inspection.performedById),
    })
    performedByName = performer?.name || null
  }

  // Get inspection items with photos
  const items = await db
    .select({
      id: inspectionItems.id,
      productSnapshot: inspectionItems.productSnapshot,
      overallCondition: inspectionItems.overallCondition,
      notes: inspectionItems.notes,
    })
    .from(inspectionItems)
    .where(eq(inspectionItems.inspectionId, inspectionId))

  // Get photos for each item
  const itemsWithPhotos = await Promise.all(
    items.map(async (item) => {
      const photos = await db
        .select({
          id: inspectionPhotos.id,
          photoUrl: inspectionPhotos.photoUrl,
          caption: inspectionPhotos.caption,
        })
        .from(inspectionPhotos)
        .where(eq(inspectionPhotos.inspectionItemId, item.id))

      const productName =
        (item.productSnapshot as { name?: string })?.name || 'Équipement'

      return {
        productName,
        condition: item.overallCondition as ConditionRating,
        notes: item.notes,
        photos: photos.map((p) => ({
          url: p.photoUrl,
          caption: p.caption,
        })),
      }
    })
  )

  // Generate document number
  const documentNumber = await generateInspectionDocumentNumber(store.id)

  // Get translations for the locale
  const translations = getTranslations(locale)

  // Convert store logo to PDF-compatible format
  const pdfLogoUrl = await convertImageForPdf(getLogoForLightBackground(store))

  // Generate PDF buffer
  const pdfBuffer = await renderToBuffer(
    InspectionReportDocument({
      inspection: {
        id: inspection.id,
        type: inspection.type as 'departure' | 'return',
        status: inspection.status as 'draft' | 'completed' | 'signed',
        reservationNumber: reservation.number,
        customerName,
        hasDamage: inspection.hasDamage,
        notes: inspection.notes,
        performedByName,
        createdAt: inspection.createdAt,
        signedAt: inspection.signedAt,
        signatureIp: inspection.signatureIp,
        customerSignature: inspection.customerSignature,
        items: itemsWithPhotos,
      },
      store: {
        name: store.name,
        logoUrl: pdfLogoUrl,
        address: store.address,
        phone: store.phone,
        email: store.email,
        primaryColor: store.theme?.primaryColor || '#0066FF',
      },
      document: {
        number: documentNumber,
        generatedAt: new Date(),
      },
      locale,
      translations,
    })
  )

  // Generate filename
  const typeLabel = locale === 'fr'
    ? (inspection.type === 'departure' ? 'depart' : 'retour')
    : inspection.type
  const fileName = locale === 'fr'
    ? `etat-des-lieux-${typeLabel}-${reservation.number}.pdf`
    : `inspection-${typeLabel}-${reservation.number}.pdf`

  return {
    buffer: pdfBuffer,
    fileName,
    documentNumber,
  }
}

async function generateInspectionDocumentNumber(storeId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = 'EDL' // État Des Lieux

  // Count existing inspections for this store this year
  const storeReservations = await db.query.reservations.findMany({
    where: eq(reservations.storeId, storeId),
    columns: { id: true },
  })

  const reservationIds = storeReservations.map((r) => r.id)

  if (reservationIds.length === 0) {
    return `${prefix}-${year}-0001`
  }

  // Get count of inspections for these reservations this year
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inspections)
    .where(
      and(
        sql`${inspections.reservationId} IN (${sql.join(
          reservationIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        sql`YEAR(${inspections.createdAt}) = ${year}`
      )
    )

  const sequence = (result?.count || 0) + 1

  return `${prefix}-${year}-${sequence.toString().padStart(4, '0')}`
}

export async function getInspectionReportPdfBuffer(
  inspectionId: string,
  locale: SupportedLocale = 'fr'
): Promise<{ buffer: Buffer; fileName: string } | null> {
  try {
    const result = await generateInspectionReport({
      inspectionId,
      locale,
    })

    return {
      buffer: result.buffer as Buffer,
      fileName: result.fileName,
    }
  } catch (error) {
    console.error('Error generating inspection report:', error)
    return null
  }
}
