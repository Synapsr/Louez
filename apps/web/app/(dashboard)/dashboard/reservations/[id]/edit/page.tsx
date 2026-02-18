import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, products } from '@louez/db'
import { eq, and, inArray, gte, ne } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import { subDays } from 'date-fns'
import { EditReservationForm } from './edit-reservation-form'

interface EditReservationPageProps {
  params: Promise<{ id: string }>
}

// Fetch existing reservations for availability conflict checking (excluding current reservation)
async function getActiveReservations(storeId: string, excludeReservationId: string) {
  const thirtyDaysAgo = subDays(new Date(), 30)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      ne(reservations.id, excludeReservationId),
      inArray(reservations.status, ['pending', 'confirmed', 'ongoing']),
      gte(reservations.endDate, thirtyDaysAgo)
    ),
    with: {
      items: {
        columns: {
          productId: true,
          quantity: true,
        },
      },
    },
    columns: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  })
}

export default async function EditReservationPage({
  params,
}: EditReservationPageProps) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const { id } = await params

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, id), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
      items: {
        with: {
          product: {
            with: {
              pricingTiers: true,
            },
          },
        },
      },
    },
  })

  if (!reservation) {
    notFound()
  }

  // Cannot edit completed, cancelled or rejected reservations
  if (['completed', 'cancelled', 'rejected'].includes(reservation.status)) {
    redirect(`/dashboard/reservations/${id}`)
  }

  // Fetch products and existing reservations in parallel
  const [availableProducts, existingReservations] = await Promise.all([
    db.query.products.findMany({
      where: and(eq(products.storeId, store.id), eq(products.status, 'active')),
      with: {
        pricingTiers: true,
      },
      orderBy: (products, { asc }) => [asc(products.name)],
    }),
    getActiveReservations(store.id, id),
  ])

  const currency = store.settings?.currency || 'EUR'

  return (
    <EditReservationForm
      reservation={{
        id: reservation.id,
        number: reservation.number,
        status: reservation.status,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        subtotalAmount: reservation.subtotalAmount,
        depositAmount: reservation.depositAmount,
        items: reservation.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          depositPerUnit: item.depositPerUnit,
          totalPrice: item.totalPrice,
          isCustomItem: item.isCustomItem,
          pricingBreakdown: item.pricingBreakdown,
          productSnapshot: item.productSnapshot,
          product: item.product
            ? {
                id: item.product.id,
                name: item.product.name,
                price: item.product.price,
                deposit: item.product.deposit ?? '0',
                quantity: item.product.quantity,
                pricingMode: item.product.pricingMode,
                pricingTiers: item.product.pricingTiers.map((tier) => ({
                  id: tier.id,
                  minDuration: tier.minDuration ?? 1,
                  discountPercent: tier.discountPercent ?? '0',
                })),
              }
            : null,
        })),
        customer: {
          firstName: reservation.customer.firstName,
          lastName: reservation.customer.lastName,
        },
      }}
      availableProducts={availableProducts.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        deposit: p.deposit || '0',
        quantity: p.quantity,
        pricingMode: p.pricingMode,
        pricingTiers: p.pricingTiers.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration ?? 1,
          discountPercent: tier.discountPercent ?? '0',
        })),
      }))}
      existingReservations={existingReservations}
      currency={currency}
      storeSettings={store.settings || null}
    />
  )
}
