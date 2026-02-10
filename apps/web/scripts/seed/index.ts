#!/usr/bin/env tsx
/**
 * Louez Database Seed Script
 *
 * DEVELOPMENT ONLY - This script generates realistic test data
 * for multiple stores with different configurations.
 *
 * Usage:
 *   pnpm db:seed --email=dev@example.com
 *   pnpm db:seed -e dev@example.com -m 6 -y
 */

import 'dotenv/config'
import { drizzle } from 'drizzle-orm/mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'

import {
  validateEnvironment,
  parseCliArgs,
  askConfirmation,
  getDateRanges,
  STORE_CONFIGS,
  type StoreConfig,
} from './config'
import {
  generateId,
  generateStripeId,
  generateReferralCode,
  generateIcsToken,
  logSection,
  logSuccess,
  logInfo,
  logError,
  colors,
} from './utils'
import { generateProducts } from './generators/products'
import { generateCustomers } from './generators/customers'
import { generateTeam } from './generators/team'
import { generateReservations } from './generators/reservations'
import { generatePayments } from './generators/payments'
import { generateAnalytics } from './generators/analytics'

// Import schema
import * as schema from '@louez/db'
import type {
  StoreSettings,
  StoreTheme,
  EmailSettings,
  NotificationSettings,
  CustomerNotificationSettings,
  BusinessHours,
  TaxSettings,
} from '@louez/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDB = ReturnType<typeof drizzle<any>>

/**
 * Create or get the owner user
 */
async function getOrCreateUser(
  db: DrizzleDB,
  email: string,
  now: Date
): Promise<string> {
  // Check if user exists
  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existingUser.length > 0) {
    logInfo(`Using existing user: ${email}`)
    return existingUser[0].id
  }

  // Create new user
  const userId = generateId()
  await db.insert(schema.users).values({
    id: userId,
    email,
    name: 'Développeur Louez',
    image: `https://ui-avatars.com/api/?name=Dev&background=0D8ABC&color=fff&size=128`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })

  logSuccess(`Created new user: ${email}`)
  return userId
}

/**
 * Generate store settings based on config
 */
function generateStoreSettings(config: StoreConfig): StoreSettings {
  const settings: StoreSettings = {
    pricingMode: config.pricingMode,
    reservationMode: config.reservationMode,
    minRentalHours: config.pricingMode === 'hour' ? 2 : config.pricingMode === 'week' ? 168 : 24,
    maxRentalHours: null,
    advanceNotice: config.pricingMode === 'hour' ? 4 : 24,
    requireCustomerAddress: config.reservationMode === 'payment',
    pendingBlocksAvailability: config.reservationMode === 'request',
    onlinePaymentDepositPercentage: config.onlinePaymentDepositPercentage,
    country: 'FR',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  }

  // Add tax settings
  if (config.taxEnabled) {
    settings.tax = {
      enabled: true,
      defaultRate: config.taxRate,
      displayMode: config.taxMode,
      taxLabel: 'TVA',
      taxNumber: `FR${Math.floor(Math.random() * 1000000000000).toString().padStart(11, '0')}`,
    }
  }

  // Add business hours
  if (config.businessHoursEnabled) {
    const schedule: BusinessHours['schedule'] = {
      0: { isOpen: false, openTime: '09:00', closeTime: '18:00' }, // Sunday closed
      1: { isOpen: true, openTime: '09:00', closeTime: '18:00' },
      2: { isOpen: true, openTime: '09:00', closeTime: '18:00' },
      3: { isOpen: true, openTime: '09:00', closeTime: '18:00' },
      4: { isOpen: true, openTime: '09:00', closeTime: '18:00' },
      5: { isOpen: true, openTime: '09:00', closeTime: '18:00' },
      6: { isOpen: true, openTime: '10:00', closeTime: '17:00' }, // Saturday shorter
    }

    settings.businessHours = {
      enabled: true,
      schedule,
      closurePeriods: [
        {
          id: nanoid(),
          name: 'Vacances de Noël',
          startDate: '2025-12-24',
          endDate: '2026-01-02',
          reason: 'Fermeture annuelle',
        },
      ],
    }
  }

  return settings
}

/**
 * Generate store theme
 */
function generateStoreTheme(config: StoreConfig): StoreTheme {
  const colors: Record<string, string> = {
    'city-bikes': '#2563EB', // Blue
    'e-bikes': '#059669', // Green
    mtb: '#DC2626', // Red
    family: '#7C3AED', // Purple
  }

  return {
    mode: config.specialty === 'e-bikes' ? 'dark' : 'light',
    primaryColor: colors[config.specialty] || '#0066FF',
    heroImages: [
      `https://picsum.photos/seed/${config.slug}-1/1920/600`,
      `https://picsum.photos/seed/${config.slug}-2/1920/600`,
    ],
  }
}

/**
 * Generate email settings
 */
function generateEmailSettings(): EmailSettings {
  return {
    confirmationEnabled: true,
    reminderPickupEnabled: true,
    reminderReturnEnabled: true,
    replyToEmail: null,
    defaultSignature: 'L\'équipe de location',
  }
}

/**
 * Generate notification settings
 */
function generateNotificationSettings(): NotificationSettings {
  return {
    reservation_new: { email: true, sms: false, discord: false },
    reservation_confirmed: { email: true, sms: false, discord: false },
    reservation_rejected: { email: true, sms: false, discord: false },
    reservation_cancelled: { email: true, sms: false, discord: false },
    reservation_picked_up: { email: false, sms: false, discord: false },
    reservation_completed: { email: false, sms: false, discord: false },
    payment_received: { email: true, sms: false, discord: false },
    payment_failed: { email: true, sms: false, discord: false },
  }
}

/**
 * Generate customer notification settings
 */
function generateCustomerNotificationSettings(): CustomerNotificationSettings {
  return {
    customer_request_received: { enabled: true, email: true, sms: false },
    customer_request_accepted: { enabled: true, email: true, sms: false },
    customer_request_rejected: { enabled: true, email: true, sms: false },
    customer_reservation_confirmed: { enabled: true, email: true, sms: false },
    customer_reminder_pickup: { enabled: true, email: true, sms: false },
    customer_reminder_return: { enabled: true, email: true, sms: false },
    customer_payment_requested: { enabled: true, email: true, sms: false },
    customer_deposit_authorization_requested: { enabled: true, email: true, sms: false },
    templates: {},
    reminderSettings: {
      pickupReminderHours: 24,
      returnReminderHours: 24,
    },
  }
}

/**
 * Seed a single store with all its data
 */
async function seedStore(
  db: DrizzleDB,
  config: StoreConfig,
  ownerId: string,
  startDate: Date,
  endDate: Date,
  now: Date
): Promise<void> {
  logSection(`Creating store: ${config.name}`)

  // Create store
  const storeId = generateId()

  await db.insert(schema.stores).values({
    id: storeId,
    userId: ownerId,
    name: config.name,
    slug: config.slug,
    description: config.description,
    email: `contact@${config.slug}.fr`,
    phone: `01 ${Math.floor(Math.random() * 90 + 10)} ${Math.floor(Math.random() * 90 + 10)} ${Math.floor(Math.random() * 90 + 10)} ${Math.floor(Math.random() * 90 + 10)}`,
    address: `${Math.floor(Math.random() * 200) + 1} Rue de la République`,
    latitude: '48.8566',
    longitude: '2.3522',
    logoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(config.name)}&background=random&size=200`,
    settings: generateStoreSettings(config),
    theme: generateStoreTheme(config),
    cgv: 'Conditions générales de vente...',
    legalNotice: 'Mentions légales...',
    stripeAccountId: config.stripeEnabled ? generateStripeId('acct') : null,
    stripeOnboardingComplete: config.stripeEnabled,
    stripeChargesEnabled: config.stripeEnabled,
    emailSettings: generateEmailSettings(),
    notificationSettings: generateNotificationSettings(),
    customerNotificationSettings: generateCustomerNotificationSettings(),
    icsToken: generateIcsToken(),
    referralCode: generateReferralCode(),
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  })

  logSuccess(`Store created: ${config.name} (${storeId})`)

  // Create subscription
  await db.insert(schema.subscriptions).values({
    id: generateId(),
    storeId,
    planSlug: config.planSlug,
    status: 'active',
    stripeSubscriptionId: config.stripeEnabled ? generateStripeId('sub') : null,
    stripeCustomerId: config.stripeEnabled ? generateStripeId('cus') : null,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  })

  logSuccess(`Subscription created: ${config.planSlug}`)

  // Create SMS credits (for pro/ultra)
  if (config.planSlug !== 'start') {
    await db.insert(schema.smsCredits).values({
      id: generateId(),
      storeId,
      balance: config.planSlug === 'ultra' ? 450 : 40,
      totalPurchased: config.planSlug === 'ultra' ? 100 : 0,
      totalUsed: config.planSlug === 'ultra' ? 150 : 10,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Generate team
  logInfo('Generating team...')
  const teamData = generateTeam(storeId, ownerId, config, now)

  if (teamData.users.length > 0) {
    await db.insert(schema.users).values(teamData.users)
  }
  await db.insert(schema.storeMembers).values(teamData.storeMembers)
  if (teamData.storeInvitations.length > 0) {
    await db.insert(schema.storeInvitations).values(teamData.storeInvitations)
  }

  logSuccess(`Team created: ${teamData.storeMembers.length} members, ${teamData.storeInvitations.length} invitations`)

  // Generate products
  logInfo('Generating products...')
  const productsData = generateProducts(storeId, config, now)

  if (productsData.categories.length > 0) {
    await db.insert(schema.categories).values(productsData.categories)
  }
  if (productsData.products.length > 0) {
    await db.insert(schema.products).values(productsData.products)
  }
  if (productsData.pricingTiers.length > 0) {
    await db.insert(schema.productPricingTiers).values(productsData.pricingTiers)
  }
  if (productsData.accessories.length > 0) {
    await db.insert(schema.productAccessories).values(productsData.accessories)
  }
  if (productsData.productUnits.length > 0) {
    await db.insert(schema.productUnits).values(productsData.productUnits)
  }

  logSuccess(
    `Products created: ${productsData.categories.length} categories, ` +
      `${productsData.products.length} products, ` +
      `${productsData.productUnits.length} units`
  )

  // Generate customers
  logInfo('Generating customers...')
  const customersData = generateCustomers(storeId, config, now, startDate)

  if (customersData.customers.length > 0) {
    await db.insert(schema.customers).values(customersData.customers)
  }
  if (customersData.customerSessions.length > 0) {
    await db.insert(schema.customerSessions).values(customersData.customerSessions)
  }

  logSuccess(
    `Customers created: ${customersData.customers.length} customers, ` +
      `${customersData.customerSessions.length} sessions`
  )

  // Generate reservations
  logInfo('Generating reservations...')
  const teamUserIds = teamData.storeMembers.map((m) => m.userId)
  const reservationsData = generateReservations(
    storeId,
    config,
    productsData.products,
    productsData.productUnits,
    customersData.customers,
    teamUserIds,
    startDate,
    endDate,
    now
  )

  if (reservationsData.reservations.length > 0) {
    await db.insert(schema.reservations).values(reservationsData.reservations)
  }
  if (reservationsData.reservationItems.length > 0) {
    await db.insert(schema.reservationItems).values(reservationsData.reservationItems)
  }
  if (reservationsData.reservationItemUnits.length > 0) {
    await db.insert(schema.reservationItemUnits).values(reservationsData.reservationItemUnits)
  }
  if (reservationsData.reservationActivity.length > 0) {
    await db.insert(schema.reservationActivity).values(reservationsData.reservationActivity)
  }

  logSuccess(
    `Reservations created: ${reservationsData.reservations.length} reservations, ` +
      `${reservationsData.reservationItems.length} items, ` +
      `${reservationsData.reservationItemUnits.length} unit assignments`
  )

  // Generate payments
  logInfo('Generating payments...')
  const paymentsData = generatePayments(reservationsData.reservations, config, now)

  if (paymentsData.length > 0) {
    await db.insert(schema.payments).values(paymentsData)
  }

  logSuccess(`Payments created: ${paymentsData.length} payments`)

  // Generate analytics (only for pro/ultra)
  if (config.planSlug !== 'start') {
    logInfo('Generating analytics...')
    const analyticsData = generateAnalytics(
      storeId,
      config,
      productsData.products,
      customersData.customers,
      reservationsData.reservations,
      startDate,
      endDate,
      now
    )

    if (analyticsData.pageViews.length > 0) {
      // Insert in batches to avoid memory issues
      const batchSize = 1000
      for (let i = 0; i < analyticsData.pageViews.length; i += batchSize) {
        const batch = analyticsData.pageViews.slice(i, i + batchSize)
        await db.insert(schema.pageViews).values(batch)
      }
    }
    if (analyticsData.storefrontEvents.length > 0) {
      const batchSize = 1000
      for (let i = 0; i < analyticsData.storefrontEvents.length; i += batchSize) {
        const batch = analyticsData.storefrontEvents.slice(i, i + batchSize)
        await db.insert(schema.storefrontEvents).values(batch)
      }
    }
    if (analyticsData.dailyStats.length > 0) {
      await db.insert(schema.dailyStats).values(analyticsData.dailyStats)
    }
    if (analyticsData.productStats.length > 0) {
      await db.insert(schema.productStats).values(analyticsData.productStats)
    }

    logSuccess(
      `Analytics created: ${analyticsData.pageViews.length} page views, ` +
        `${analyticsData.storefrontEvents.length} events, ` +
        `${analyticsData.dailyStats.length} daily stats`
    )
  }

  console.log('')
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('')
  console.log(`${colors.cyan}${colors.bold}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.cyan}${colors.bold}║         LOUEZ - DATABASE SEED SCRIPT                       ║${colors.reset}`)
  console.log(`${colors.cyan}${colors.bold}║         Development Only                                   ║${colors.reset}`)
  console.log(`${colors.cyan}${colors.bold}╚════════════════════════════════════════════════════════════╝${colors.reset}`)
  console.log('')

  // Validate environment
  validateEnvironment()

  // Parse CLI arguments
  const config = parseCliArgs()

  // Ask for confirmation
  const confirmed = await askConfirmation(config)
  if (!confirmed) {
    console.log('')
    logInfo('Seed cancelled by user.')
    process.exit(0)
  }

  // Calculate date ranges
  const { startDate, endDate, now } = getDateRanges(config.months)

  console.log('')
  logInfo(`Date range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`)

  // Connect to database
  logInfo('Connecting to database...')

  const pool = createPool(process.env.DATABASE_URL!)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = drizzle(pool as any, { schema, mode: 'default' }) as DrizzleDB

  logSuccess('Database connected')

  try {
    // Get or create owner user
    const ownerId = await getOrCreateUser(db, config.userEmail, now)

    // Seed each store
    for (const storeConfig of STORE_CONFIGS) {
      await seedStore(db, storeConfig, ownerId, startDate, endDate, now)
    }

    console.log('')
    console.log(`${colors.green}${colors.bold}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
    console.log(`${colors.green}${colors.bold}║         SEED COMPLETED SUCCESSFULLY!                       ║${colors.reset}`)
    console.log(`${colors.green}${colors.bold}╚════════════════════════════════════════════════════════════╝${colors.reset}`)
    console.log('')
    console.log(`${colors.bold}Created stores:${colors.reset}`)
    for (const storeConfig of STORE_CONFIGS) {
      console.log(`  - ${storeConfig.name} (${storeConfig.slug})`)
    }
    console.log('')
    console.log(`${colors.dim}Login with: ${config.userEmail}${colors.reset}`)
    console.log(`${colors.dim}Use Drizzle Studio to explore: pnpm db:studio${colors.reset}`)
    console.log('')
  } catch (error) {
    console.log('')
    logError('Seed failed!')
    console.error(error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

// Run
main().catch(console.error)
