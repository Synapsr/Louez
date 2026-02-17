import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import { and, eq } from 'drizzle-orm'

type PricingMode = 'hour' | 'day' | 'week'

type CliOptions = {
  threshold: number
  failOnMismatch: boolean
  storeId?: string
  productId?: string
  limit?: number
}

type ParityMismatch = {
  productId: string
  mode: PricingMode
  durationUnits: number
  legacySubtotal: number
  v2Subtotal: number
  diff: number
}

type LegacyTier = {
  minDuration: number
  discountPercent: number
}

type Rate = {
  period: number
  price: number
}

function printUsage(): void {
  console.log(`Usage:
  pnpm pricing:parity-report
  pnpm pricing:parity-report -- --threshold 0.01
  pnpm pricing:parity-report -- --store-id <storeId>
  pnpm pricing:parity-report -- --product-id <productId>
  pnpm pricing:parity-report -- --limit <count>
  pnpm pricing:parity-report -- --no-fail
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    threshold: 0.01,
    failOnMismatch: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--') {
      continue
    }

    if (arg === '--threshold') {
      const value = Number.parseFloat(argv[i + 1] ?? '')
      if (Number.isFinite(value) && value >= 0) {
        options.threshold = value
      }
      i += 1
      continue
    }

    if (arg === '--no-fail') {
      options.failOnMismatch = false
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

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function pricingModeToMinutes(mode: PricingMode): number {
  if (mode === 'hour') return 60
  if (mode === 'week') return 10080
  return 1440
}

function calculateLegacySubtotal(
  basePrice: number,
  tiers: LegacyTier[],
  durationUnits: number,
): number {
  const applicableTier = [...tiers]
    .sort((a, b) => b.minDuration - a.minDuration)
    .find((tier) => durationUnits >= tier.minDuration)

  const effectivePricePerUnit = applicableTier
    ? basePrice * (1 - applicableTier.discountPercent / 100)
    : basePrice

  return roundCurrency(effectivePricePerUnit * durationUnits)
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function gcdOfList(values: number[]): number {
  if (values.length === 0) return 1
  return values.reduce((acc, value) => gcd(acc, value), values[0] || 1)
}

function calculateBestRateCost(durationMinutes: number, rates: Rate[]): number {
  const normalizedRates = rates
    .filter((rate) => rate.period > 0 && rate.price >= 0)
    .sort((a, b) => a.period - b.period)

  if (normalizedRates.length === 0) {
    return 0
  }

  const targetMinutes = Math.max(1, Math.ceil(durationMinutes))
  const scale = gcdOfList(normalizedRates.map((rate) => rate.period))
  const rateSteps = normalizedRates.map((rate) =>
    Math.max(1, Math.round(rate.period / scale)),
  )
  const targetSteps = Math.max(1, Math.ceil(targetMinutes / scale))
  const maxRateStep = Math.max(...rateSteps)
  const maxSteps = targetSteps + maxRateStep

  const dp = Array<number>(maxSteps + 1).fill(Number.POSITIVE_INFINITY)
  dp[0] = 0

  for (let step = 1; step <= maxSteps; step += 1) {
    for (let i = 0; i < normalizedRates.length; i += 1) {
      const rateStep = rateSteps[i]
      if (step < rateStep) continue
      const source = step - rateStep
      if (!Number.isFinite(dp[source])) continue

      const candidateCost = dp[source] + normalizedRates[i].price
      if (candidateCost < dp[step]) {
        dp[step] = candidateCost
      }
    }
  }

  let bestStep = -1
  for (let step = targetSteps; step <= maxSteps; step += 1) {
    if (!Number.isFinite(dp[step])) continue
    if (bestStep === -1 || dp[step] < dp[bestStep]) {
      bestStep = step
    }
  }

  if (bestStep === -1) {
    const fallback = normalizedRates[0]
    const count = Math.ceil(targetMinutes / fallback.period)
    return roundCurrency(count * fallback.price)
  }

  return roundCurrency(dp[bestStep])
}

function calculateV2Subtotal(
  basePrice: number,
  basePeriodMinutes: number,
  rateTiers: Rate[],
  durationMinutes: number,
): number {
  const baseRate: Rate = {
    price: basePrice,
    period: basePeriodMinutes,
  }
  const rates = [baseRate, ...rateTiers]
  return calculateBestRateCost(durationMinutes, rates)
}

function isLegacyEquivalentProduct(
  basePrice: number,
  modePeriodMinutes: number,
  tiers: Array<{
    minDuration: number | null
    discountPercent: string | number | null
    period: number | null
    price: string | null
  }>,
): boolean {
  for (const tier of tiers) {
    const hasLegacy =
      typeof tier.minDuration === 'number' &&
      tier.minDuration > 0 &&
      tier.discountPercent !== null &&
      tier.discountPercent !== undefined
    const hasRate =
      typeof tier.period === 'number' &&
      tier.period > 0 &&
      tier.price !== null &&
      tier.price !== undefined

    if (!hasLegacy && hasRate) {
      return false
    }

    if (!hasLegacy || !hasRate) {
      continue
    }

    const minDuration = tier.minDuration as number
    const discountPercent = toNumber(tier.discountPercent)
    const expectedPeriod = minDuration * modePeriodMinutes
    const expectedPrice = roundCurrency(
      basePrice * (1 - discountPercent / 100) * minDuration,
    )
    const actualPrice = toNumber(tier.price)
    if (tier.period !== expectedPeriod) {
      return false
    }
    if (Math.abs(actualPrice - expectedPrice) > 0.01) {
      return false
    }
  }

  return true
}

function getParityCap(mode: PricingMode): number {
  if (mode === 'hour') return 24 * 30
  if (mode === 'week') return 52
  return 365
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const { db, products } = (await import('../index')) as typeof import('../index')

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

  const mismatches: ParityMismatch[] = []
  let productsChecked = 0
  let productsSkippedBasePeriod = 0
  let productsSkippedNonLegacy = 0
  let maxDiff = 0

  console.log(
    `[pricing-parity] threshold=${options.threshold} products=${targetProducts.length}`,
  )

  for (const product of targetProducts) {
    const mode = product.pricingMode as PricingMode
    const modePeriodMinutes = pricingModeToMinutes(mode)
    const basePeriodMinutes = product.basePeriodMinutes ?? modePeriodMinutes

    // Parity is only guaranteed for legacy-equivalent base period.
    if (basePeriodMinutes !== modePeriodMinutes) {
      productsSkippedBasePeriod += 1
      continue
    }

    const basePrice = toNumber(product.price)
    const legacyTiers = (product.pricingTiers ?? [])
      .filter(
        (tier): tier is typeof tier & { minDuration: number; discountPercent: string | number } =>
          typeof tier.minDuration === 'number' &&
          tier.minDuration > 0 &&
          tier.discountPercent !== null &&
          tier.discountPercent !== undefined,
      )
      .map((tier) => ({
        minDuration: tier.minDuration,
        discountPercent: toNumber(tier.discountPercent),
      }))

    const v2Rates = (product.pricingTiers ?? [])
      .filter(
        (tier): tier is typeof tier & { period: number; price: string | number } =>
          typeof tier.period === 'number' &&
          tier.period > 0 &&
          tier.price !== null &&
          tier.price !== undefined,
      )
      .map((tier) => ({
        period: tier.period,
        price: toNumber(tier.price),
      }))

    if (
      !isLegacyEquivalentProduct(basePrice, modePeriodMinutes, product.pricingTiers ?? [])
    ) {
      productsSkippedNonLegacy += 1
      continue
    }

    productsChecked += 1
    const cap = getParityCap(mode)
    for (let durationUnits = 1; durationUnits <= cap; durationUnits += 1) {
      const legacySubtotal = calculateLegacySubtotal(
        basePrice,
        legacyTiers,
        durationUnits,
      )

      const v2Subtotal = calculateV2Subtotal(
        basePrice,
        basePeriodMinutes,
        v2Rates,
        durationUnits * modePeriodMinutes,
      )

      const diff = Math.abs(legacySubtotal - v2Subtotal)
      if (diff > maxDiff) {
        maxDiff = diff
      }
      if (diff > options.threshold) {
        mismatches.push({
          productId: product.id,
          mode,
          durationUnits,
          legacySubtotal,
          v2Subtotal,
          diff,
        })
      }
    }
  }

  const mismatchedProducts = new Set(mismatches.map((entry) => entry.productId))
  console.table({
    productsScanned: targetProducts.length,
    productsChecked,
    productsSkippedBasePeriod,
    productsSkippedNonLegacy,
    mismatchedProducts: mismatchedProducts.size,
    mismatchedPoints: mismatches.length,
    threshold: options.threshold,
    maxDiff,
  })

  if (mismatches.length > 0) {
    console.log('[pricing-parity] mismatch sample (first 20):')
    console.table(mismatches.slice(0, 20))
  } else {
    console.log('[pricing-parity] no mismatches above threshold')
  }

  if (options.failOnMismatch && mismatches.length > 0) {
    process.exit(1)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error('[pricing-parity] failed')
  console.error(error)
  process.exit(1)
})
