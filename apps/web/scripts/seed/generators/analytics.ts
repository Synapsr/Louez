/**
 * Analytics Generator
 *
 * Generates page views, storefront events, daily stats, and product stats.
 */

import type { StoreConfig } from '../config'
import type { GeneratedProduct } from './products'
import type { GeneratedReservation } from './reservations'
import type { GeneratedCustomer } from './customers'
import {
  generateId,
  generateSessionId,
  pickRandom,
  randomInt,
  randomDecimal,
  chance,
  weightedRandom,
  randomDate,
  startOfDay,
  addDays,
  addMinutes,
  logProgress,
} from '../utils'

export interface GeneratedPageView {
  id: string
  storeId: string
  sessionId: string
  page: 'home' | 'catalog' | 'product' | 'cart' | 'checkout' | 'confirmation' | 'account' | 'rental'
  productId: string | null
  categoryId: string | null
  referrer: string | null
  device: 'mobile' | 'tablet' | 'desktop'
  createdAt: Date
}

export type StorefrontEventType =
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'update_quantity'
  | 'checkout_started'
  | 'checkout_completed'
  | 'checkout_abandoned'
  | 'payment_initiated'
  | 'payment_completed'
  | 'payment_failed'
  | 'login_requested'
  | 'login_completed'

export interface GeneratedStorefrontEvent {
  id: string
  storeId: string
  sessionId: string
  customerId: string | null
  eventType: StorefrontEventType
  metadata: Record<string, unknown> | null
  createdAt: Date
}

export interface GeneratedDailyStats {
  id: string
  storeId: string
  date: Date
  pageViews: number
  uniqueVisitors: number
  productViews: number
  cartAdditions: number
  checkoutStarted: number
  checkoutCompleted: number
  reservationsCreated: number
  reservationsConfirmed: number
  revenue: string
  averageCartValue: string | null
  mobileVisitors: number
  tabletVisitors: number
  desktopVisitors: number
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedProductStats {
  id: string
  storeId: string
  productId: string
  date: Date
  views: number
  cartAdditions: number
  reservations: number
  revenue: string
  createdAt: Date
  updatedAt: Date
}

export interface AnalyticsGeneratorResult {
  pageViews: GeneratedPageView[]
  storefrontEvents: GeneratedStorefrontEvent[]
  dailyStats: GeneratedDailyStats[]
  productStats: GeneratedProductStats[]
}

const REFERRERS = [
  'https://www.google.fr/',
  'https://www.google.com/',
  'https://www.facebook.com/',
  'https://www.instagram.com/',
  'https://maps.google.com/',
  'https://www.tripadvisor.fr/',
  'https://www.booking.com/',
  'https://www.yelp.fr/',
  null, // Direct traffic
  null,
  null,
]

/**
 * Generate a user session with multiple page views and events
 */
function generateSession(
  storeId: string,
  products: GeneratedProduct[],
  customers: GeneratedCustomer[],
  sessionDate: Date,
  conversionRate: number
): {
  pageViews: GeneratedPageView[]
  events: GeneratedStorefrontEvent[]
} {
  const pageViews: GeneratedPageView[] = []
  const events: GeneratedStorefrontEvent[] = []

  const sessionId = generateSessionId()
  const device = weightedRandom([
    { item: 'mobile' as const, weight: 0.6 },
    { item: 'desktop' as const, weight: 0.35 },
    { item: 'tablet' as const, weight: 0.05 },
  ])
  const referrer = pickRandom(REFERRERS)

  // Possibly logged in customer
  const isLoggedIn = chance(0.3)
  const customer = isLoggedIn ? pickRandom(customers) : null
  const customerId = customer?.id ?? null

  let currentTime = sessionDate
  const activeProducts = products.filter((p) => p.status === 'active')

  // 1. Home page
  pageViews.push({
    id: generateId(),
    storeId,
    sessionId,
    page: 'home',
    productId: null,
    categoryId: null,
    referrer,
    device,
    createdAt: currentTime,
  })
  currentTime = addMinutes(currentTime, randomInt(10, 60))

  // 70% continue to catalog
  if (chance(0.7)) {
    pageViews.push({
      id: generateId(),
      storeId,
      sessionId,
      page: 'catalog',
      productId: null,
      categoryId: null,
      referrer: null,
      device,
      createdAt: currentTime,
    })
    currentTime = addMinutes(currentTime, randomInt(20, 120))

    // 60% view a product
    if (chance(0.6) && activeProducts.length > 0) {
      const viewedProduct = pickRandom(activeProducts)

      pageViews.push({
        id: generateId(),
        storeId,
        sessionId,
        page: 'product',
        productId: viewedProduct.id,
        categoryId: viewedProduct.categoryId,
        referrer: null,
        device,
        createdAt: currentTime,
      })

      events.push({
        id: generateId(),
        storeId,
        sessionId,
        customerId,
        eventType: 'product_view',
        metadata: { productId: viewedProduct.id, productName: viewedProduct.name },
        createdAt: currentTime,
      })
      currentTime = addMinutes(currentTime, randomInt(30, 180))

      // 35% add to cart
      if (chance(0.35)) {
        events.push({
          id: generateId(),
          storeId,
          sessionId,
          customerId,
          eventType: 'add_to_cart',
          metadata: {
            productId: viewedProduct.id,
            productName: viewedProduct.name,
            quantity: randomInt(1, 2),
            price: viewedProduct.price,
          },
          createdAt: currentTime,
        })

        pageViews.push({
          id: generateId(),
          storeId,
          sessionId,
          page: 'cart',
          productId: null,
          categoryId: null,
          referrer: null,
          device,
          createdAt: currentTime,
        })
        currentTime = addMinutes(currentTime, randomInt(5, 30))

        // 50% start checkout
        if (chance(0.5)) {
          pageViews.push({
            id: generateId(),
            storeId,
            sessionId,
            page: 'checkout',
            productId: null,
            categoryId: null,
            referrer: null,
            device,
            createdAt: currentTime,
          })

          events.push({
            id: generateId(),
            storeId,
            sessionId,
            customerId,
            eventType: 'checkout_started',
            metadata: { cartValue: viewedProduct.price },
            createdAt: currentTime,
          })
          currentTime = addMinutes(currentTime, randomInt(5, 20))

          // Conversion based on rate
          if (chance(conversionRate)) {
            events.push({
              id: generateId(),
              storeId,
              sessionId,
              customerId,
              eventType: 'payment_initiated',
              metadata: null,
              createdAt: currentTime,
            })
            currentTime = addMinutes(currentTime, randomInt(2, 10))

            events.push({
              id: generateId(),
              storeId,
              sessionId,
              customerId,
              eventType: 'payment_completed',
              metadata: { amount: viewedProduct.price },
              createdAt: currentTime,
            })
            currentTime = addMinutes(currentTime, randomInt(1, 5))

            events.push({
              id: generateId(),
              storeId,
              sessionId,
              customerId,
              eventType: 'checkout_completed',
              metadata: null,
              createdAt: currentTime,
            })

            pageViews.push({
              id: generateId(),
              storeId,
              sessionId,
              page: 'confirmation',
              productId: null,
              categoryId: null,
              referrer: null,
              device,
              createdAt: currentTime,
            })
          } else {
            // Abandoned checkout
            events.push({
              id: generateId(),
              storeId,
              sessionId,
              customerId,
              eventType: 'checkout_abandoned',
              metadata: null,
              createdAt: addMinutes(currentTime, randomInt(10, 60)),
            })
          }
        }
      }
    }
  }

  return { pageViews, events }
}

/**
 * Generate all analytics data for a store
 */
export function generateAnalytics(
  storeId: string,
  storeConfig: StoreConfig,
  products: GeneratedProduct[],
  customers: GeneratedCustomer[],
  reservations: GeneratedReservation[],
  startDate: Date,
  endDate: Date,
  now: Date
): AnalyticsGeneratorResult {
  const pageViews: GeneratedPageView[] = []
  const storefrontEvents: GeneratedStorefrontEvent[] = []
  const dailyStats: GeneratedDailyStats[] = []
  const productStats: GeneratedProductStats[] = []

  // Only generate analytics for pro/ultra plans
  if (storeConfig.planSlug === 'start') {
    return { pageViews, storefrontEvents, dailyStats, productStats }
  }

  const activeProducts = products.filter((p) => p.status === 'active')
  const totalDays = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

  // Product stats aggregation
  const productStatsMap = new Map<
    string,
    Map<string, { views: number; cartAdditions: number; reservations: number; revenue: number }>
  >()

  // Generate daily data
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const dayDate = startOfDay(addDays(startDate, dayOffset))
    if (dayDate > now) break

    // Number of sessions varies by day (more on weekends)
    const dayOfWeek = dayDate.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const baseSessions = isWeekend ? randomInt(15, 40) : randomInt(8, 25)

    // Seasonal variation (summer months have more traffic)
    const month = dayDate.getMonth()
    const isSummer = month >= 5 && month <= 8
    const sessionsCount = isSummer ? Math.floor(baseSessions * 1.5) : baseSessions

    let dayPageViews = 0
    let dayProductViews = 0
    let dayCartAdditions = 0
    let dayCheckoutStarted = 0
    let dayCheckoutCompleted = 0
    let dayMobile = 0
    let dayTablet = 0
    let dayDesktop = 0
    const uniqueSessions = new Set<string>()

    // Conversion rate varies
    const conversionRate = storeConfig.stripeEnabled ? randomInt(40, 70) / 100 : randomInt(20, 40) / 100

    // Generate sessions for this day
    for (let s = 0; s < sessionsCount; s++) {
      const sessionTime = new Date(
        dayDate.getTime() + randomInt(8, 22) * 60 * 60 * 1000 + randomInt(0, 59) * 60 * 1000
      )

      const { pageViews: sessionPageViews, events: sessionEvents } = generateSession(
        storeId,
        products,
        customers,
        sessionTime,
        conversionRate
      )

      pageViews.push(...sessionPageViews)
      storefrontEvents.push(...sessionEvents)

      // Aggregate stats
      dayPageViews += sessionPageViews.length
      uniqueSessions.add(sessionPageViews[0]?.sessionId || '')

      const deviceForSession = sessionPageViews[0]?.device
      if (deviceForSession === 'mobile') dayMobile++
      else if (deviceForSession === 'tablet') dayTablet++
      else dayDesktop++

      // Count events
      for (const event of sessionEvents) {
        if (event.eventType === 'product_view') {
          dayProductViews++

          // Update product stats
          const productId = (event.metadata as { productId?: string })?.productId
          if (productId) {
            const dateKey = dayDate.toISOString().split('T')[0]
            if (!productStatsMap.has(productId)) {
              productStatsMap.set(productId, new Map())
            }
            const productMap = productStatsMap.get(productId)!
            if (!productMap.has(dateKey)) {
              productMap.set(dateKey, { views: 0, cartAdditions: 0, reservations: 0, revenue: 0 })
            }
            productMap.get(dateKey)!.views++
          }
        }
        if (event.eventType === 'add_to_cart') {
          dayCartAdditions++

          const productId = (event.metadata as { productId?: string })?.productId
          if (productId) {
            const dateKey = dayDate.toISOString().split('T')[0]
            const productMap = productStatsMap.get(productId)
            if (productMap?.has(dateKey)) {
              productMap.get(dateKey)!.cartAdditions++
            }
          }
        }
        if (event.eventType === 'checkout_started') dayCheckoutStarted++
        if (event.eventType === 'checkout_completed') dayCheckoutCompleted++
      }
    }

    // Count reservations for this day
    const dayReservations = reservations.filter(
      (r) =>
        startOfDay(r.createdAt).getTime() === dayDate.getTime() &&
        ['pending', 'confirmed', 'ongoing', 'completed'].includes(r.status)
    )
    const dayConfirmed = dayReservations.filter((r) =>
      ['confirmed', 'ongoing', 'completed'].includes(r.status)
    )

    // Calculate revenue
    const dayRevenue = dayConfirmed.reduce((sum, r) => sum + parseFloat(r.subtotalAmount), 0)
    const avgCartValue =
      dayCheckoutCompleted > 0 ? dayRevenue / dayCheckoutCompleted : 0

    dailyStats.push({
      id: generateId(),
      storeId,
      date: dayDate,
      pageViews: dayPageViews,
      uniqueVisitors: uniqueSessions.size,
      productViews: dayProductViews,
      cartAdditions: dayCartAdditions,
      checkoutStarted: dayCheckoutStarted,
      checkoutCompleted: dayCheckoutCompleted,
      reservationsCreated: dayReservations.length,
      reservationsConfirmed: dayConfirmed.length,
      revenue: dayRevenue.toFixed(2),
      averageCartValue: avgCartValue > 0 ? avgCartValue.toFixed(2) : null,
      mobileVisitors: dayMobile,
      tabletVisitors: dayTablet,
      desktopVisitors: dayDesktop,
      createdAt: dayDate,
      updatedAt: now,
    })

    logProgress(dayOffset + 1, totalDays, `Analytics for ${storeConfig.name}`)
  }

  // Convert product stats map to array
  for (const [productId, dateMap] of Array.from(productStatsMap.entries())) {
    for (const [dateKey, stats] of Array.from(dateMap.entries())) {
      productStats.push({
        id: generateId(),
        storeId,
        productId,
        date: new Date(dateKey),
        views: stats.views,
        cartAdditions: stats.cartAdditions,
        reservations: stats.reservations,
        revenue: stats.revenue.toFixed(2),
        createdAt: new Date(dateKey),
        updatedAt: now,
      })
    }
  }

  return {
    pageViews,
    storefrontEvents,
    dailyStats,
    productStats,
  }
}
