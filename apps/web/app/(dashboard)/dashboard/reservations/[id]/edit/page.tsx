import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, products } from '@louez/db'
import { eq, and, inArray, gte, ne } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import { subDays } from 'date-fns'
import type { DeliverySettings, LegMethod } from '@louez/types'
import type { SeasonalPricingConfig } from '@louez/utils'
import { getTulipSettings } from '@/lib/integrations/tulip/settings'
import { EditReservationForm } from './edit-reservation-form'
import type { PricingTier, Product, StoreDeliveryInfo } from './types'

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

/**
 * Map raw DB pricing tiers to the shape needed by the edit form.
 * Includes both tier-based fields (minDuration, discountPercent) and
 * rate-based fields (period, price) so pricing calculations work for all modes.
 */
function mapPricingTiers(
  tiers: Array<{
    id: string
    minDuration: number | null
    discountPercent: string | null
    period: number | null
    price: string | null
    displayOrder: number | null
  }>,
): PricingTier[] {
  return tiers.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: parseFloat(tier.discountPercent ?? '0'),
    period: tier.period ?? null,
    price: tier.price !== null ? parseFloat(tier.price) : null,
    displayOrder: tier.displayOrder ?? index,
  }))
}

/**
 * Map raw DB seasonal pricing + tiers to the SeasonalPricingConfig shape
 * expected by the shared pricing utilities.
 */
function mapSeasonalPricings(
  seasonalPricings: Array<{
    id: string
    name: string
    startDate: string
    endDate: string
    price: string
    tiers: Array<{
      id: string
      minDuration: number | null
      discountPercent: string | null
      period: number | null
      price: string | null
      displayOrder: number | null
    }>
  }>,
): SeasonalPricingConfig[] {
  return seasonalPricings.map((sp) => ({
    id: sp.id,
    name: sp.name,
    startDate: sp.startDate,
    endDate: sp.endDate,
    basePrice: parseFloat(sp.price),
    tiers: sp.tiers
      .filter((t) => t.minDuration !== null)
      .map((t, i) => ({
        id: t.id,
        minDuration: t.minDuration ?? 1,
        discountPercent: parseFloat(t.discountPercent ?? '0'),
        displayOrder: t.displayOrder ?? i,
      })),
    rates: sp.tiers
      .filter(
        (t): t is typeof t & { period: number; price: string } =>
          typeof t.period === 'number' &&
          t.period > 0 &&
          typeof t.price === 'string',
      )
      .map((t, i) => ({
        id: t.id,
        period: t.period,
        price: parseFloat(t.price),
        displayOrder: t.displayOrder ?? i,
      })),
  }))
}

/**
 * Map a raw DB product (with relations) to the Product shape for the edit form.
 */
function mapProduct(
  p: {
    id: string
    name: string
    price: string
    deposit: string | null
    quantity: number
    pricingMode: string | null
    basePeriodMinutes: number | null
    enforceStrictTiers: boolean
    pricingTiers: Array<{
      id: string
      minDuration: number | null
      discountPercent: string | null
      period: number | null
      price: string | null
      displayOrder: number | null
    }>
    seasonalPricings: Array<{
      id: string
      name: string
      startDate: string
      endDate: string
      price: string
      tiers: Array<{
        id: string
        minDuration: number | null
        discountPercent: string | null
        period: number | null
        price: string | null
        displayOrder: number | null
      }>
    }>
    tulipMapping?: { productId: string } | null
  },
): Product {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    deposit: p.deposit ?? '0',
    quantity: p.quantity,
    pricingMode: p.pricingMode,
    basePeriodMinutes: p.basePeriodMinutes,
    enforceStrictTiers: p.enforceStrictTiers,
    tulipInsurable: Boolean(p.tulipMapping?.productId),
    pricingTiers: mapPricingTiers(p.pricingTiers),
    seasonalPricings: mapSeasonalPricings(p.seasonalPricings),
  }
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
              seasonalPricings: {
                with: { tiers: true },
              },
              tulipMapping: {
                columns: {
                  productId: true,
                },
              },
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
        seasonalPricings: {
          with: { tiers: true },
        },
        tulipMapping: {
          columns: {
            productId: true,
          },
        },
      },
      orderBy: (products, { asc }) => [asc(products.name)],
    }),
    getActiveReservations(store.id, id),
  ])

  const currency = store.settings?.currency || 'EUR'
  const tulipSettings = getTulipSettings(store.settings || null)
  const tulipInsuranceMode =
    !tulipSettings.enabled
      ? 'no_public'
      : tulipSettings.publicMode === 'required'
        ? 'required'
        : 'optional'

  // Build delivery info from store settings
  const deliverySettings = (store.settings as Record<string, unknown> | null)
    ?.delivery as DeliverySettings | undefined
  const storeDelivery: StoreDeliveryInfo | null = deliverySettings?.enabled
    ? {
        settings: deliverySettings,
        latitude: store.latitude ? parseFloat(store.latitude) : null,
        longitude: store.longitude ? parseFloat(store.longitude) : null,
        address: store.address ?? null,
      }
    : null

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
        totalAmount: reservation.totalAmount,
        deliveryFee: reservation.deliveryFee,
        discountAmount: reservation.discountAmount,
        tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
        tulipInsuranceAmount: reservation.tulipInsuranceAmount,
        delivery: {
          outboundMethod: (reservation.outboundMethod as LegMethod) ?? 'store',
          returnMethod: (reservation.returnMethod as LegMethod) ?? 'store',
          deliveryAddress: reservation.deliveryAddress,
          deliveryCity: reservation.deliveryCity,
          deliveryPostalCode: reservation.deliveryPostalCode,
          deliveryCountry: reservation.deliveryCountry,
          deliveryLatitude: reservation.deliveryLatitude,
          deliveryLongitude: reservation.deliveryLongitude,
          deliveryDistanceKm: reservation.deliveryDistanceKm,
          deliveryFee: reservation.deliveryFee,
          returnAddress: reservation.returnAddress,
          returnCity: reservation.returnCity,
          returnPostalCode: reservation.returnPostalCode,
          returnCountry: reservation.returnCountry,
          returnLatitude: reservation.returnLatitude,
          returnLongitude: reservation.returnLongitude,
          returnDistanceKm: reservation.returnDistanceKm,
        },
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
            ? mapProduct(item.product)
            : null,
        })),
        customer: {
          firstName: reservation.customer.firstName,
          lastName: reservation.customer.lastName,
        },
      }}
      availableProducts={availableProducts.map(mapProduct)}
      existingReservations={existingReservations}
      currency={currency}
      tulipInsuranceMode={tulipInsuranceMode}
      storeSettings={store.settings || null}
      storeDelivery={storeDelivery}
    />
  )
}
