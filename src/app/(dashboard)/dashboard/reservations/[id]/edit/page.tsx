import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, products } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EditReservationForm } from './edit-reservation-form'

interface EditReservationPageProps {
  params: Promise<{ id: string }>
}

export default async function EditReservationPage({
  params,
}: EditReservationPageProps) {
  const t = await getTranslations('dashboard.reservations')
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

  // Cannot edit completed reservations
  if (reservation.status === 'completed') {
    redirect(`/dashboard/reservations/${id}`)
  }

  // Get all active products for adding new items
  const availableProducts = await db.query.products.findMany({
    where: and(eq(products.storeId, store.id), eq(products.status, 'active')),
    with: {
      pricingTiers: true,
    },
    orderBy: (products, { asc }) => [asc(products.name)],
  })

  const pricingMode = store.settings?.pricingMode || 'day'
  const currency = store.settings?.currency || 'EUR'

  return (
    <EditReservationForm
      reservation={{
        id: reservation.id,
        number: reservation.number,
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
                pricingMode: item.product.pricingMode,
                pricingTiers: item.product.pricingTiers.map((tier) => ({
                  id: tier.id,
                  minDuration: tier.minDuration,
                  discountPercent: tier.discountPercent,
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
        pricingMode: p.pricingMode,
        pricingTiers: p.pricingTiers.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent: tier.discountPercent,
        })),
      }))}
      pricingMode={pricingMode}
      currency={currency}
    />
  )
}
