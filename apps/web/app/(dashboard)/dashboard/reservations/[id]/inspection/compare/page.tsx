import { notFound, redirect } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { db } from '@louez/db'
import {
  reservations,
  inspections,
  inspectionItems,
  inspectionPhotos,
  customers
} from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { ComparisonView } from './comparison-view'
import type { ConditionRating } from '@louez/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InspectionComparePage({ params }: PageProps) {
  const { id: reservationId } = await params

  const store = await getCurrentStore()
  if (!store) {
    redirect('/login')
  }

  // Get reservation
  const [reservation] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      customerId: reservations.customerId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id)
      )
    )
    .limit(1)

  if (!reservation) {
    notFound()
  }

  // Get customer name
  const [customer] = await db
    .select({
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(eq(customers.id, reservation.customerId))
    .limit(1)

  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : 'Client'

  // Get both inspections
  const reservationInspections = await db
    .select({
      id: inspections.id,
      type: inspections.type,
      status: inspections.status,
      hasDamage: inspections.hasDamage,
      notes: inspections.notes,
      createdAt: inspections.createdAt,
      signedAt: inspections.signedAt,
      customerSignature: inspections.customerSignature,
    })
    .from(inspections)
    .where(eq(inspections.reservationId, reservationId))

  const departureInspection = reservationInspections.find((i) => i.type === 'departure')
  const returnInspection = reservationInspections.find((i) => i.type === 'return')

  // Need at least one inspection
  if (!departureInspection && !returnInspection) {
    redirect(`/dashboard/reservations/${reservationId}`)
  }

  // Get items with photos for each inspection
  const getInspectionData = async (inspectionId: string | undefined) => {
    if (!inspectionId) return null

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
            thumbnailUrl: inspectionPhotos.thumbnailUrl,
            caption: inspectionPhotos.caption,
          })
          .from(inspectionPhotos)
          .where(eq(inspectionPhotos.inspectionItemId, item.id))

        // Get product name from snapshot
        const productName = item.productSnapshot?.name || 'Équipement'

        return {
          id: item.id,
          productName,
          condition: item.overallCondition as ConditionRating,
          notes: item.notes,
          photos: photos.map((p) => ({
            id: p.id,
            url: p.photoUrl,
            thumbnailUrl: p.thumbnailUrl,
            caption: p.caption,
          })),
        }
      })
    )

    return itemsWithPhotos
  }

  const departureItems = departureInspection
    ? await getInspectionData(departureInspection.id)
    : null
  const returnItems = returnInspection
    ? await getInspectionData(returnInspection.id)
    : null

  // Format data for comparison view
  const formattedDeparture = departureInspection && departureItems ? {
    id: departureInspection.id,
    type: 'departure' as const,
    status: departureInspection.status as 'draft' | 'completed' | 'signed',
    hasDamage: departureInspection.hasDamage,
    notes: departureInspection.notes,
    createdAt: departureInspection.createdAt,
    signedAt: departureInspection.signedAt,
    hasSignature: !!departureInspection.customerSignature,
    items: departureItems,
  } : null

  const formattedReturn = returnInspection && returnItems ? {
    id: returnInspection.id,
    type: 'return' as const,
    status: returnInspection.status as 'draft' | 'completed' | 'signed',
    hasDamage: returnInspection.hasDamage,
    notes: returnInspection.notes,
    createdAt: returnInspection.createdAt,
    signedAt: returnInspection.signedAt,
    hasSignature: !!returnInspection.customerSignature,
    items: returnItems,
  } : null

  return (
    <ComparisonView
      reservationId={reservationId}
      reservationNumber={reservation.number}
      customerName={customerName}
      departure={formattedDeparture}
      return_={formattedReturn}
    />
  )
}
