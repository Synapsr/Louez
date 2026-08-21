import {
  db,
  inspections,
  inspectionItems,
  inspectionPhotos,
  documents,
  invoicePayments,
  invoices,
  payments,
  reservations,
  storeLegalProfiles,
} from '@louez/db'
import { and, desc, eq, gt, inArray, isNull, ne, notInArray } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'

import { getDashboardReservationById } from '@louez/api/services'
import { DEFAULT_INSPECTION_SETTINGS } from '@louez/types'

import { DashboardBreadcrumbLabel } from '@/components/dashboard/dashboard-breadcrumbs-context'

import { isSmsConfigured } from '@/lib/sms'
import { getCurrentStore } from '@/lib/store-context'

import { ReservationDetailClient } from './reservation-detail-client'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface ReservationDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ReservationDetailPage({
  params,
}: ReservationDetailPageProps) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const { id } = await params

  let reservation: any
  try {
    reservation = await getDashboardReservationById({
      reservationId: id,
      storeId: store.id,
    })
  } catch {
    notFound()
  }

  if (!reservation) {
    notFound()
  }

  const currency = store.settings?.currency || 'EUR'
  const storeTimezone = store.settings?.timezone
  const smsConfigured = isSmsConfigured()
  const stripeConfigured = Boolean(store.stripeAccountId)
  const inspectionSettings =
    store.settings?.inspection || DEFAULT_INSPECTION_SETTINGS

  // Default the payment method select to the store's last manually recorded method
  const [lastManualPayment] = await db
    .select({ method: payments.method })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(payments.status, 'completed'),
        ne(payments.method, 'stripe'),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1)

  const defaultPaymentMethod =
    lastManualPayment && lastManualPayment.method !== 'stripe'
      ? lastManualPayment.method
      : 'cash'

  const reservationInspections = await db
    .select({
      id: inspections.id,
      type: inspections.type,
      status: inspections.status,
      hasDamage: inspections.hasDamage,
      createdAt: inspections.createdAt,
      signedAt: inspections.signedAt,
    })
    .from(inspections)
    .where(eq(inspections.reservationId, id))

  const departureInspection = reservationInspections.find(
    (i) => i.type === 'departure',
  )
  const returnInspection = reservationInspections.find(
    (i) => i.type === 'return',
  )

  const getInspectionData = async (inspectionId: string | undefined) => {
    if (!inspectionId) return null

    const items = await db
      .select({ id: inspectionItems.id })
      .from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, inspectionId))

    const photos = await db
      .select({ id: inspectionPhotos.id })
      .from(inspectionPhotos)
      .innerJoin(
        inspectionItems,
        eq(inspectionItems.id, inspectionPhotos.inspectionItemId),
      )
      .where(eq(inspectionItems.inspectionId, inspectionId))

    return { itemCount: items.length, photoCount: photos.length }
  }

  const departureData = departureInspection
    ? await getInspectionData(departureInspection.id)
    : null
  const returnData = returnInspection ? await getInspectionData(returnInspection.id) : null

  const linkedPaymentIds = db.select({ paymentId: invoicePayments.paymentId }).from(invoicePayments)
  const [reservationInvoices, legalProfile, uninvoicedPayment] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        type: invoices.type,
        issueDate: invoices.issueDate,
        totalInclTax: invoices.totalInclTax,
        currency: invoices.currency,
        transmissionStatus: invoices.transmissionStatus,
      })
      .from(invoices)
      .innerJoin(documents, eq(documents.id, invoices.documentId))
      .where(and(eq(invoices.reservationId, id), eq(invoices.storeId, store.id)))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt)),
    db
      .select({ invoicingEnabled: storeLegalProfiles.invoicingEnabled })
      .from(storeLegalProfiles)
      .where(eq(storeLegalProfiles.storeId, store.id))
      .limit(1)
      .then(([profile]) => profile ?? null),
    db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, id),
          eq(payments.status, 'completed'),
          isNull(payments.stripeRefundId),
          inArray(payments.type, ['rental', 'damage', 'adjustment', 'deposit_capture']),
          gt(payments.amount, '0'),
          notInArray(payments.id, linkedPaymentIds),
        ),
      )
      .limit(1)
      .then(([payment]) => payment ?? null),
  ])

  const formattedDepartureInspection =
    departureInspection && departureData
      ? {
          id: departureInspection.id,
          type: departureInspection.type as 'departure' | 'return',
          status: departureInspection.status as 'draft' | 'completed' | 'signed',
          hasDamage: departureInspection.hasDamage,
          itemCount: departureData.itemCount,
          photoCount: departureData.photoCount,
          createdAt: departureInspection.createdAt,
          signedAt: departureInspection.signedAt,
        }
      : null

  const formattedReturnInspection =
    returnInspection && returnData
      ? {
          id: returnInspection.id,
          type: returnInspection.type as 'departure' | 'return',
          status: returnInspection.status as 'draft' | 'completed' | 'signed',
          hasDamage: returnInspection.hasDamage,
          itemCount: returnData.itemCount,
          photoCount: returnData.photoCount,
          createdAt: returnInspection.createdAt,
          signedAt: returnInspection.signedAt,
        }
      : null

  return (
    <>
      <DashboardBreadcrumbLabel label={`#${reservation.number}`} />
      <ReservationDetailClient
        reservationId={id}
        initialReservation={reservation}
        storeSlug={store.slug}
        currency={currency}
        storeTimezone={storeTimezone}
        smsConfigured={smsConfigured}
        stripeConfigured={stripeConfigured}
        defaultPaymentMethod={defaultPaymentMethod}
        inspectionSettings={inspectionSettings}
        departureInspection={formattedDepartureInspection}
        returnInspection={formattedReturnInspection}
        invoices={reservationInvoices}
        canGenerateInvoice={Boolean(legalProfile?.invoicingEnabled && uninvoicedPayment)}
      />
    </>
  )
}
