import { notFound, redirect } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  reservations,
  reservationItems,
  products,
  customers,
  stores,
  inspections,
  inspectionItems,
  inspectionPhotos,
  users,
} from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { InspectionWizard } from './components/inspection-wizard'
import { InspectionView } from './components/inspection-view'
import { DEFAULT_INSPECTION_SETTINGS } from '@/types/store'
import type { InspectionType, ConditionRating } from '@/types/inspection'

interface PageProps {
  params: Promise<{
    id: string
    type: string
  }>
}

export default async function InspectionPage({ params }: PageProps) {
  const { id: reservationId, type } = await params

  // Validate type
  if (type !== 'departure' && type !== 'return') {
    notFound()
  }

  const inspectionType = type as InspectionType

  const store = await getCurrentStore()
  if (!store) {
    redirect('/login')
  }

  // Get store settings
  const [storeData] = await db
    .select({ settings: stores.settings })
    .from(stores)
    .where(eq(stores.id, store.id))
    .limit(1)

  const settings = storeData?.settings as { inspection?: typeof DEFAULT_INSPECTION_SETTINGS } | null
  const inspectionSettings = settings?.inspection || DEFAULT_INSPECTION_SETTINGS

  // Check if inspections are enabled
  if (!inspectionSettings.enabled) {
    redirect(`/dashboard/reservations/${reservationId}`)
  }

  // Get reservation
  const [reservation] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      status: reservations.status,
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

  // Get customer
  const [customer] = await db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(eq(customers.id, reservation.customerId))
    .limit(1)

  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : 'Client'

  // Check if inspection already exists
  const [existingInspection] = await db
    .select({
      id: inspections.id,
      type: inspections.type,
      status: inspections.status,
      hasDamage: inspections.hasDamage,
      notes: inspections.notes,
      performedById: inspections.performedById,
      createdAt: inspections.createdAt,
      signedAt: inspections.signedAt,
      customerSignature: inspections.customerSignature,
    })
    .from(inspections)
    .where(
      and(
        eq(inspections.reservationId, reservationId),
        eq(inspections.type, inspectionType)
      )
    )
    .limit(1)

  // If inspection exists, show the view
  if (existingInspection) {
    // Get performer name
    let performedByName: string | null = null
    if (existingInspection.performedById) {
      const [performer] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, existingInspection.performedById))
        .limit(1)
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
      .where(eq(inspectionItems.inspectionId, existingInspection.id))

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

        const productName =
          (item.productSnapshot as { name?: string })?.name || 'Équipement'

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

    return (
      <InspectionView
        inspection={{
          id: existingInspection.id,
          type: existingInspection.type as InspectionType,
          status: existingInspection.status as 'draft' | 'completed' | 'signed',
          hasDamage: existingInspection.hasDamage,
          notes: existingInspection.notes,
          performedByName,
          createdAt: existingInspection.createdAt,
          signedAt: existingInspection.signedAt,
          customerSignature: existingInspection.customerSignature,
          items: itemsWithPhotos,
        }}
        reservationId={reservationId}
        reservationNumber={reservation.number}
        customerName={customerName}
      />
    )
  }

  // Validate reservation status for creating new inspection
  if (inspectionType === 'departure' && reservation.status !== 'confirmed') {
    redirect(`/dashboard/reservations/${reservationId}`)
  }

  if (inspectionType === 'return' && reservation.status !== 'ongoing') {
    redirect(`/dashboard/reservations/${reservationId}`)
  }

  // Get reservation items with products for wizard
  const reservationItemsData = await db
    .select({
      id: reservationItems.id,
      quantity: reservationItems.quantity,
      productId: reservationItems.productId,
      productName: products.name,
      productImages: products.images,
    })
    .from(reservationItems)
    .innerJoin(products, eq(products.id, reservationItems.productId))
    .where(eq(reservationItems.reservationId, reservationId))

  const formattedItems = reservationItemsData
    .filter((item) => item.productId !== null)
    .map((item) => ({
      id: item.id,
      quantity: item.quantity,
      product: {
        id: item.productId as string,
        name: item.productName,
        images: (item.productImages as string[]) || [],
      },
    }))

  return (
    <InspectionWizard
      reservationId={reservationId}
      reservationNumber={reservation.number}
      customerName={customerName}
      type={inspectionType}
      items={formattedItems}
      requireSignature={inspectionSettings.requireCustomerSignature}
      maxPhotosPerItem={inspectionSettings.maxPhotosPerItem}
    />
  )
}
