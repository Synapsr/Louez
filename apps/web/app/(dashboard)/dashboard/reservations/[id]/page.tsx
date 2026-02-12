import { db, inspections, inspectionItems, inspectionPhotos } from '@louez/db'
import { eq } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'

import { getDashboardReservationById } from '@louez/api/services'
import { DEFAULT_INSPECTION_SETTINGS } from '@louez/types'

import { isSmsConfigured } from '@/lib/sms'
import { getCurrentStore } from '@/lib/store-context'

import { ReservationDetailClient } from './reservation-detail-client'

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
    <ReservationDetailClient
      reservationId={id}
      initialReservation={reservation}
      storeSlug={store.slug}
      currency={currency}
      storeTimezone={storeTimezone}
      smsConfigured={smsConfigured}
      stripeConfigured={stripeConfigured}
      inspectionSettings={inspectionSettings}
      departureInspection={formattedDepartureInspection}
      returnInspection={formattedReturnInspection}
    />
  )
}

