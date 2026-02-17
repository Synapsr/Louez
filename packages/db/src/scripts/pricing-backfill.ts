import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import { and, eq } from 'drizzle-orm'

type CliOptions = {
  apply: boolean
  storeId?: string
  productId?: string
  limit?: number
}

type BackfillReport = {
  productsScanned: number
  productsUpdatedBasePeriod: number
  tiersScanned: number
  tiersUpdated: number
  tiersAlreadyBackfilled: number
  tiersSkippedMissingLegacyData: number
}

function pricingModeToMinutes(mode: 'hour' | 'day' | 'week'): number {
  if (mode === 'hour') return 60
  if (mode === 'week') return 10080
  return 1440
}

function printUsage(): void {
  console.log(`Usage:
  pnpm pricing:backfill -- --dry-run
  pnpm pricing:backfill -- --apply
  pnpm pricing:backfill -- --apply --store-id <storeId>
  pnpm pricing:backfill -- --apply --product-id <productId>
  pnpm pricing:backfill -- --apply --limit <count>
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--') {
      continue
    }

    if (arg === '--apply') {
      options.apply = true
      continue
    }

    if (arg === '--dry-run') {
      options.apply = false
      continue
    }

    if (arg === '--store-id') {
      options.storeId = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--product-id') {
      options.productId = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--limit') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) {
        options.limit = value
      }
      i += 1
      continue
    }

    console.warn(`Unknown argument ignored: ${arg}`)
  }

  return options
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const { db, products, productPricingTiers } = (await import(
    '../index'
  )) as typeof import('../index')

  const filters = []
  if (options.storeId) {
    filters.push(eq(products.storeId, options.storeId))
  }
  if (options.productId) {
    filters.push(eq(products.id, options.productId))
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined
  const productsList = await db.query.products.findMany({
    where: whereClause,
    with: {
      pricingTiers: true,
    },
  })

  const targetProducts = options.limit
    ? productsList.slice(0, options.limit)
    : productsList

  const report: BackfillReport = {
    productsScanned: 0,
    productsUpdatedBasePeriod: 0,
    tiersScanned: 0,
    tiersUpdated: 0,
    tiersAlreadyBackfilled: 0,
    tiersSkippedMissingLegacyData: 0,
  }

  console.log(
    `[pricing-backfill] mode=${options.apply ? 'apply' : 'dry-run'} products=${targetProducts.length}`,
  )

  for (const product of targetProducts) {
    report.productsScanned += 1
    const basePrice = toNumber(product.price)
    const resolvedBasePeriod =
      product.basePeriodMinutes ??
      pricingModeToMinutes(product.pricingMode as 'hour' | 'day' | 'week')

    if (!product.basePeriodMinutes) {
      report.productsUpdatedBasePeriod += 1
      if (options.apply) {
        await db
          .update(products)
          .set({
            basePeriodMinutes: resolvedBasePeriod,
            updatedAt: new Date(),
          })
          .where(eq(products.id, product.id))
      }
    }

    for (const tier of product.pricingTiers ?? []) {
      report.tiersScanned += 1

      const hasRateFields =
        typeof tier.period === 'number' &&
        tier.period > 0 &&
        tier.price !== null &&
        tier.price !== undefined

      if (hasRateFields) {
        report.tiersAlreadyBackfilled += 1
        continue
      }

      const hasLegacyFields =
        typeof tier.minDuration === 'number' &&
        tier.minDuration > 0 &&
        tier.discountPercent !== null &&
        tier.discountPercent !== undefined

      if (!hasLegacyFields) {
        report.tiersSkippedMissingLegacyData += 1
        console.warn(
          `[pricing-backfill] tier skipped (missing legacy fields) product=${product.id} tier=${tier.id}`,
        )
        continue
      }

      const minDuration = tier.minDuration as number
      const discountPercent = toNumber(tier.discountPercent)
      const period = minDuration * resolvedBasePeriod
      const totalPrice = roundMoney(
        basePrice * (1 - discountPercent / 100) * minDuration,
      )

      report.tiersUpdated += 1
      if (options.apply) {
        await db
          .update(productPricingTiers)
          .set({
            period,
            price: totalPrice.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(productPricingTiers.id, tier.id))
      }
    }
  }

  console.log('[pricing-backfill] done')
  console.table(report)
}

main().catch((error) => {
  console.error('[pricing-backfill] failed')
  console.error(error)
  process.exit(1)
})
