import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import { and, eq } from 'drizzle-orm'

type PricingMode = 'hour' | 'day' | 'week'

type CliOptions = {
  threshold: number
  top: number
  storeId?: string
  productId?: string
  limit?: number
}

type LegacyTier = {
  minDuration: number
  discountPercent: number
}

type Rate = {
  period: number
  price: number
}

type ProductParitySummary = {
  productId: string
  mode: PricingMode
  mismatchCount: number
  maxDiff: number
  avgDiff: number
  firstMismatchDuration: number
}

function printUsage(): void {
  console.log(`Usage:
  pnpm pricing:parity-top-products
  pnpm pricing:parity-top-products -- --top 10
  pnpm pricing:parity-top-products -- --threshold 0.01
  pnpm pricing:parity-top-products -- --store-id <storeId>
  pnpm pricing:parity-top-products -- --product-id <productId>
  pnpm pricing:parity-top-products -- --limit <count>
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    threshold: 0.01,
    top: 10,
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

    if (arg === '--top') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) {
        options.top = value
      }
      i += 1
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
  return calculateBestRateCost(durationMinutes, [baseRate, ...rateTiers])
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

  const summaries: ProductParitySummary[] = []
  let productsChecked = 0
  let productsSkippedBasePeriod = 0
  let productsSkippedNonLegacy = 0

  for (const product of targetProducts) {
    if (
      product.pricingMode !== 'hour' &&
      product.pricingMode !== 'day' &&
      product.pricingMode !== 'week'
    ) {
      continue
    }
    const mode = product.pricingMode as PricingMode
    const modePeriodMinutes = pricingModeToMinutes(mode)
    const basePeriodMinutes = product.basePeriodMinutes ?? modePeriodMinutes

    if (basePeriodMinutes !== modePeriodMinutes) {
      productsSkippedBasePeriod += 1
      continue
    }

    const basePrice = toNumber(product.price)
    if (
      !isLegacyEquivalentProduct(basePrice, modePeriodMinutes, product.pricingTiers ?? [])
    ) {
      productsSkippedNonLegacy += 1
      continue
    }

    productsChecked += 1

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

    const cap = getParityCap(mode)
    let mismatchCount = 0
    let maxDiff = 0
    let sumDiff = 0
    let firstMismatchDuration = -1

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
      if (diff > options.threshold) {
        mismatchCount += 1
        sumDiff += diff
        if (firstMismatchDuration === -1) {
          firstMismatchDuration = durationUnits
        }
        if (diff > maxDiff) {
          maxDiff = diff
        }
      }
    }

    if (mismatchCount > 0) {
      summaries.push({
        productId: product.id,
        mode,
        mismatchCount,
        maxDiff: roundCurrency(maxDiff),
        avgDiff: roundCurrency(sumDiff / mismatchCount),
        firstMismatchDuration,
      })
    }
  }

  summaries.sort((a, b) => {
    if (b.maxDiff !== a.maxDiff) return b.maxDiff - a.maxDiff
    if (b.mismatchCount !== a.mismatchCount) return b.mismatchCount - a.mismatchCount
    return a.productId.localeCompare(b.productId)
  })

  console.table({
    productsScanned: targetProducts.length,
    productsChecked,
    productsSkippedBasePeriod,
    productsSkippedNonLegacy,
    mismatchedProducts: summaries.length,
    threshold: options.threshold,
    top: options.top,
  })

  if (summaries.length > 0) {
    console.log('[pricing-parity-top-products] top mismatched products')
    console.table(summaries.slice(0, options.top))
  } else {
    console.log('[pricing-parity-top-products] no mismatched products above threshold')
  }

  process.exit(0)
}

main().catch((error) => {
  console.error('[pricing-parity-top-products] failed')
  console.error(error)
  process.exit(1)
})
