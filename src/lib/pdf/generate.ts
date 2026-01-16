import { renderToBuffer } from '@react-pdf/renderer'
import { ContractDocument, ContractTranslations, SupportedLocale } from './contract'
import { db } from '@/lib/db'
import { documents, reservations, stores } from '@/lib/db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { convertImageForPdf } from './image-utils'

// Import translations
import frMessages from '@/messages/fr.json'
import enMessages from '@/messages/en.json'

interface GenerateContractOptions {
  reservationId: string
  regenerate?: boolean
  locale?: SupportedLocale
}

// Get translations for the specified locale
function getTranslations(locale: SupportedLocale): ContractTranslations {
  const messages = locale === 'fr' ? frMessages : enMessages
  return messages.contract as ContractTranslations
}

export async function generateContract({
  reservationId,
  regenerate = false,
  locale = 'fr'
}: GenerateContractOptions) {
  // Get reservation with all relations including payments
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      items: true,
      customer: true,
      payments: true,
    },
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

  // Check if contract already exists
  const existingContract = await db.query.documents.findFirst({
    where: and(
      eq(documents.reservationId, reservationId),
      eq(documents.type, 'contract')
    ),
  })

  if (existingContract && !regenerate) {
    return existingContract
  }

  // Generate document number
  const documentNumber = await generateDocumentNumber(store.id)

  // Use reservation creation date as document date (for consistency across regenerations)
  const documentData = {
    number: documentNumber,
    generatedAt: reservation.createdAt,
  }

  // Get translations for the locale
  const translations = getTranslations(locale)

  // Convert store logo to PDF-compatible format (handles SVG conversion)
  const pdfLogoUrl = await convertImageForPdf(store.logoUrl)

  // Generate PDF buffer
  const pdfBuffer = await renderToBuffer(
    ContractDocument({
      reservation: {
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        subtotalAmount: reservation.subtotalAmount,
        depositAmount: reservation.depositAmount,
        totalAmount: reservation.totalAmount,
        subtotalExclTax: reservation.subtotalExclTax,
        taxAmount: reservation.taxAmount,
        taxRate: reservation.taxRate,
        signedAt: reservation.signedAt,
        signatureIp: reservation.signatureIp,
        createdAt: reservation.createdAt,
        customer: reservation.customer,
        items: reservation.items.map((item) => ({
          productSnapshot: item.productSnapshot as { name: string; description?: string | null },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
        payments: reservation.payments.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          type: payment.type as 'rental' | 'deposit' | 'deposit_return' | 'damage',
          method: payment.method as 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other',
          status: payment.status as 'pending' | 'completed' | 'failed' | 'refunded',
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
        })),
      },
      store: {
        name: store.name,
        slug: store.slug,
        logoUrl: pdfLogoUrl,
        address: store.address,
        phone: store.phone,
        email: store.email,
        siret: null, // SIRET can be added to store settings in future
        tvaNumber: store.settings?.tax?.taxNumber || null,
        primaryColor: store.theme?.primaryColor || '#0066FF',
        billingAddress: store.settings?.billingAddress || null,
      },
      document: documentData,
      locale,
      translations,
      currency: store.settings?.currency || 'EUR',
    })
  )

  // For now, store in database as base64 (in production, upload to R2/S3)
  const base64Content = pdfBuffer.toString('base64')
  const fileName = locale === 'fr' ? `contrat-${reservation.number}.pdf` : `contract-${reservation.number}.pdf`

  // If regenerating, update existing document
  if (existingContract && regenerate) {
    await db
      .update(documents)
      .set({
        fileUrl: `data:application/pdf;base64,${base64Content}`,
        fileName, // Update filename based on locale
      })
      .where(eq(documents.id, existingContract.id))

    return await db.query.documents.findFirst({
      where: eq(documents.id, existingContract.id),
    })
  }

  // Create new document record
  const documentId = nanoid()
  await db.insert(documents).values({
    id: documentId,
    reservationId: reservation.id,
    type: 'contract',
    number: documentNumber,
    fileName,
    fileUrl: `data:application/pdf;base64,${base64Content}`,
  })

  return await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  })
}

async function generateDocumentNumber(storeId: string): Promise<string> {
  const year = new Date().getFullYear()

  // Get all documents for reservations belonging to this store
  const storeReservations = await db.query.reservations.findMany({
    where: eq(reservations.storeId, storeId),
    columns: { id: true },
  })

  const reservationIds = storeReservations.map((r) => r.id)

  if (reservationIds.length === 0) {
    return `${year}-0001`
  }

  // Get last document for these reservations this year
  const lastDoc = await db.query.documents.findFirst({
    where: and(
      sql`${documents.reservationId} IN (${sql.join(reservationIds.map(id => sql`${id}`), sql`, `)})`,
      sql`YEAR(${documents.createdAt}) = ${year}`
    ),
    orderBy: [desc(documents.createdAt)],
  })

  let sequence = 1
  if (lastDoc && lastDoc.number) {
    const parts = lastDoc.number.split('-')
    if (parts.length === 2) {
      sequence = parseInt(parts[1], 10) + 1
    }
  }

  return `${year}-${sequence.toString().padStart(4, '0')}`
}

export async function getContractPdfBuffer(reservationId: string): Promise<Buffer | null> {
  const contract = await db.query.documents.findFirst({
    where: and(
      eq(documents.reservationId, reservationId),
      eq(documents.type, 'contract')
    ),
  })

  if (!contract || !contract.fileUrl) {
    return null
  }

  // If it's a base64 data URL
  if (contract.fileUrl.startsWith('data:application/pdf;base64,')) {
    const base64 = contract.fileUrl.replace('data:application/pdf;base64,', '')
    return Buffer.from(base64, 'base64')
  }

  // In production, fetch from R2/S3
  // For now, return null for URLs
  return null
}
