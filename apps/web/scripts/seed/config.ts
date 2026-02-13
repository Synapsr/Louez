/**
 * Seed Script Configuration
 *
 * DEVELOPMENT ONLY - This script cannot be run in production.
 *
 * Generates multiple stores with different specialties and configurations
 * to test all possible states and features.
 */

import { parseArgs } from 'node:util'

export interface SeedConfig {
  userEmail: string
  months: number
  skipConfirmation: boolean
}

export interface StoreConfig {
  name: string
  slug: string
  specialty: 'city-bikes' | 'e-bikes' | 'mtb' | 'family'
  description: string
  pricingMode: 'day' | 'hour' | 'week'
  reservationMode: 'payment' | 'request'
  planSlug: 'start' | 'pro' | 'ultra'
  taxEnabled: boolean
  taxRate: number
  taxMode: 'inclusive' | 'exclusive'
  onlinePaymentDepositPercentage: number
  trackUnits: boolean
  businessHoursEnabled: boolean
  stripeEnabled: boolean
  productCount: number
  customerCount: number
  reservationCount: number
  teamSize: number
}

/**
 * Pre-configured stores with different specialties
 */
export const STORE_CONFIGS: StoreConfig[] = [
  {
    name: 'Vélo Liberté',
    slug: 'velo-liberte',
    specialty: 'city-bikes',
    description: 'Location de vélos de ville pour vos déplacements urbains. Large choix de vélos confortables et accessoires.',
    pricingMode: 'day',
    reservationMode: 'payment',
    planSlug: 'ultra',
    taxEnabled: true,
    taxRate: 20,
    taxMode: 'inclusive',
    onlinePaymentDepositPercentage: 100,
    trackUnits: true,
    businessHoursEnabled: true,
    stripeEnabled: true,
    productCount: 30,
    customerCount: 100,
    reservationCount: 200,
    teamSize: 5,
  },
  {
    name: 'E-Ride Pro',
    slug: 'e-ride-pro',
    specialty: 'e-bikes',
    description: 'Spécialiste de la location de vélos électriques haut de gamme. Batterie longue durée garantie.',
    pricingMode: 'hour',
    reservationMode: 'request',
    planSlug: 'pro',
    taxEnabled: true,
    taxRate: 20,
    taxMode: 'exclusive',
    onlinePaymentDepositPercentage: 100,
    trackUnits: true,
    businessHoursEnabled: true,
    stripeEnabled: true,
    productCount: 20,
    customerCount: 60,
    reservationCount: 120,
    teamSize: 3,
  },
  {
    name: 'VTT Aventure',
    slug: 'vtt-aventure',
    specialty: 'mtb',
    description: 'Location de VTT et équipement pour vos aventures en montagne. Conseils personnalisés inclus.',
    pricingMode: 'week',
    reservationMode: 'payment',
    planSlug: 'ultra',
    taxEnabled: true,
    taxRate: 20,
    taxMode: 'inclusive',
    onlinePaymentDepositPercentage: 50,
    trackUnits: true,
    businessHoursEnabled: false,
    stripeEnabled: true,
    productCount: 25,
    customerCount: 80,
    reservationCount: 150,
    teamSize: 4,
  },
  {
    name: 'Baby Cycle',
    slug: 'baby-cycle',
    specialty: 'family',
    description: 'Location de vélos enfants, sièges bébé et remorques. Tout pour des balades en famille en toute sécurité.',
    pricingMode: 'day',
    reservationMode: 'request',
    planSlug: 'start',
    taxEnabled: false,
    taxRate: 0,
    taxMode: 'inclusive',
    onlinePaymentDepositPercentage: 100,
    trackUnits: false,
    businessHoursEnabled: true,
    stripeEnabled: false,
    productCount: 15,
    customerCount: 40,
    reservationCount: 60,
    teamSize: 2,
  },
]

const DEFAULT_CONFIG = {
  months: 3,
}

/**
 * Validates the environment to prevent accidental production use
 */
export function validateEnvironment(): void {
  // Block production environment
  if (process.env.NODE_ENV === 'production') {
    console.error('\x1b[31m%s\x1b[0m', '='.repeat(60))
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: Seed script cannot be run in production!')
    console.error('\x1b[31m%s\x1b[0m', '='.repeat(60))
    process.exit(1)
  }

  // Block production database (port 6053)
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  if (dbUrl.includes(':6053')) {
    console.error('\x1b[31m%s\x1b[0m', '='.repeat(60))
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: Production database detected (port 6053)!')
    console.error('\x1b[31m%s\x1b[0m', 'Seed script can only run on development database (port 6984).')
    console.error('\x1b[31m%s\x1b[0m', '='.repeat(60))
    process.exit(1)
  }

  console.log('\x1b[32m%s\x1b[0m', '✓ Environment validation passed')
}

/**
 * Parses command line arguments
 */
export function parseCliArgs(): SeedConfig {
  const { values } = parseArgs({
    options: {
      email: { type: 'string', short: 'e' },
      months: { type: 'string', short: 'm' },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  if (!values.email) {
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: --email is required')
    console.log('')
    printHelp()
    process.exit(1)
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(values.email)) {
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: Invalid email format')
    process.exit(1)
  }

  return {
    userEmail: values.email,
    months: values.months ? parseInt(values.months, 10) : DEFAULT_CONFIG.months,
    skipConfirmation: values.yes ?? false,
  }
}

function printHelp(): void {
  console.log(`
\x1b[1mLouez Database Seed Script\x1b[0m
\x1b[33mDevelopment Only - Cannot run in production\x1b[0m

Generates multiple stores with different configurations to test all features.

\x1b[1mStores Generated:\x1b[0m
  1. Vélo Liberté    - Vélos de ville (Ultra, paiement, jour, TVA TTC)
  2. E-Ride Pro      - Vélos électriques (Pro, demande, heure, TVA HT)
  3. VTT Aventure    - VTT/montagne (Ultra, paiement partiel 50%, semaine)
  4. Baby Cycle      - Enfants/famille (Start, sans Stripe)

\x1b[1mUsage:\x1b[0m
  pnpm db:seed --email=<EMAIL> [options]

\x1b[1mRequired:\x1b[0m
  --email, -e       Email of the user who will own all stores

\x1b[1mOptions:\x1b[0m
  --months, -m      Months of history to generate (default: ${DEFAULT_CONFIG.months})
  --yes, -y         Skip confirmation prompt
  --help, -h        Show this help message

\x1b[1mExamples:\x1b[0m
  pnpm db:seed --email=dev@example.com
  pnpm db:seed -e dev@example.com -m 6 -y
`)
}

/**
 * Asks for user confirmation before proceeding
 */
export async function askConfirmation(config: SeedConfig): Promise<boolean> {
  if (config.skipConfirmation) {
    return true
  }

  const readline = await import('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const dbUrl = process.env.DATABASE_URL ?? ''
  // Mask password in URL for display
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@')

  const totalProducts = STORE_CONFIGS.reduce((sum, s) => sum + s.productCount, 0)
  const totalCustomers = STORE_CONFIGS.reduce((sum, s) => sum + s.customerCount, 0)
  const totalReservations = STORE_CONFIGS.reduce((sum, s) => sum + s.reservationCount, 0)

  console.log('')
  console.log('\x1b[33m%s\x1b[0m', '='.repeat(60))
  console.log('\x1b[33m%s\x1b[0m', 'SEED SCRIPT - MULTI-STORE DATA GENERATION')
  console.log('\x1b[33m%s\x1b[0m', '='.repeat(60))
  console.log('')
  console.log('You are about to generate test data with the following configuration:')
  console.log('')
  console.log(`  User Email:      \x1b[1m${config.userEmail}\x1b[0m`)
  console.log(`  Database:        \x1b[1m${maskedUrl}\x1b[0m`)
  console.log(`  Months:          ${config.months}`)
  console.log(`  Stores:          ${STORE_CONFIGS.length}`)
  console.log('')
  console.log('\x1b[1mStores to create:\x1b[0m')
  for (const store of STORE_CONFIGS) {
    console.log(`  - ${store.name} (${store.planSlug}, ${store.pricingMode}, ${store.reservationMode})`)
  }
  console.log('')
  console.log('\x1b[1mTotals:\x1b[0m')
  console.log(`  Products:        ~${totalProducts}`)
  console.log(`  Customers:       ~${totalCustomers}`)
  console.log(`  Reservations:    ~${totalReservations}`)
  console.log('')

  return new Promise((resolve) => {
    rl.question('\x1b[33mDo you want to continue? (y/N): \x1b[0m', (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Generates date ranges for the seed
 */
export function getDateRanges(months: number): {
  startDate: Date
  endDate: Date
  now: Date
} {
  const now = new Date()
  const startDate = new Date(now)
  startDate.setMonth(startDate.getMonth() - months)
  startDate.setHours(0, 0, 0, 0)

  const endDate = new Date(now)
  endDate.setMonth(endDate.getMonth() + 1)
  endDate.setHours(23, 59, 59, 999)

  return { startDate, endDate, now }
}
