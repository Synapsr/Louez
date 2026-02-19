import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import fs from 'node:fs/promises'
import path from 'node:path'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

type PricingMode = 'hour' | 'day' | 'week'

type CliOptions = {
  storeId?: string
  productId?: string
  limit?: number
  previewProducts: number
  outputJson?: string
  failOnBlockers: boolean
}

type ProductRow = RowDataPacket & {
  id: string
  storeId: string
  pricingMode: string
  price: string | number
}

type TierRow = RowDataPacket & {
  id: string
  productId: string
  minDuration: number | null
  discountPercent: string | number | null
  displayOrder: number | null
}

type IssueSeverity = 'warning' | 'blocker'

type IssueCode =
  | 'invalid_pricing_mode'
  | 'invalid_base_price'
  | 'missing_tier_legacy_fields'
  | 'invalid_tier_min_duration'
  | 'invalid_tier_discount_percent'
  | 'duplicate_computed_period'
  | 'tier_more_expensive_than_base'
  | 'non_progressive_rate'

type PreflightIssue = {
  severity: IssueSeverity
  code: IssueCode
  productId: string
  tierId?: string
  message: string
}

type ComputedTier = {
  tierId: string
  minDuration: number
  discountPercent: number
  displayOrder: number
  period: number
  price: number
}

type ProductPreview = {
  productId: string
  storeId: string
  pricingMode: string
  basePrice: number
  basePeriodMinutes: number | null
  computedTiers: ComputedTier[]
}

type PreflightReport = {
  productsScanned: number
  productsReady: number
  productsWithWarnings: number
  productsWithBlockers: number
  tiersScanned: number
  tiersComputed: number
  tiersSkipped: number
  warningCount: number
  blockerCount: number
}

function printUsage(): void {
  console.log(`Usage:
  pnpm pricing:preflight
  pnpm pricing:preflight -- --store-id <storeId>
  pnpm pricing:preflight -- --product-id <productId>
  pnpm pricing:preflight -- --limit <count>
  pnpm pricing:preflight -- --preview-products <count>
  pnpm pricing:preflight -- --output-json ./tmp/pricing-preflight.json
  pnpm pricing:preflight -- --fail-on-blockers
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    previewProducts: 10,
    failOnBlockers: false,
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

    if (arg === '--preview-products') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) {
        options.previewProducts = value
      }
      i += 1
      continue
    }

    if (arg === '--output-json') {
      options.outputJson = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--fail-on-blockers') {
      options.failOnBlockers = true
      continue
    }

    console.warn(`Unknown argument ignored: ${arg}`)
  }

  return options
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function pricingModeToMinutes(mode: string): number | null {
  if (mode === 'hour') return 60
  if (mode === 'day') return 1440
  if (mode === 'week') return 10080
  return null
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

async function fetchProducts(
  connection: Connection,
  options: CliOptions,
): Promise<ProductRow[]> {
  const where: string[] = []
  const params: Array<string | number> = []

  if (options.storeId) {
    where.push('store_id = ?')
    params.push(options.storeId)
  }

  if (options.productId) {
    where.push('id = ?')
    params.push(options.productId)
  }

  let query = `
    SELECT
      id,
      store_id AS storeId,
      pricing_mode AS pricingMode,
      price
    FROM products
  `

  if (where.length > 0) {
    query += ` WHERE ${where.join(' AND ')}`
  }

  query += ' ORDER BY id'
  if (options.limit) {
    query += ' LIMIT ?'
    params.push(options.limit)
  }

  const [rows] = await connection.query<ProductRow[]>(query, params)
  return rows
}

async function fetchTiers(
  connection: Connection,
  productIds: string[],
): Promise<TierRow[]> {
  if (productIds.length === 0) return []

  const chunks = chunk(productIds, 500)
  const allRows: TierRow[] = []

  for (const ids of chunks) {
    const placeholders = ids.map(() => '?').join(', ')
    const query = `
      SELECT
        id,
        product_id AS productId,
        min_duration AS minDuration,
        discount_percent AS discountPercent,
        display_order AS displayOrder
      FROM product_pricing_tiers
      WHERE product_id IN (${placeholders})
      ORDER BY product_id ASC, display_order ASC, min_duration ASC, id ASC
    `
    const [rows] = await connection.query<TierRow[]>(query, ids)
    allRows.push(...rows)
  }

  return allRows
}

function addIssue(
  issues: PreflightIssue[],
  report: PreflightReport,
  issue: PreflightIssue,
): void {
  issues.push(issue)
  if (issue.severity === 'blocker') {
    report.blockerCount += 1
    return
  }
  report.warningCount += 1
}

function toPricingMode(mode: string): PricingMode | null {
  if (mode === 'hour' || mode === 'day' || mode === 'week') {
    return mode
  }
  return null
}

function printPreview(previews: ProductPreview[], maxProducts: number): void {
  if (previews.length === 0) {
    console.log('[pricing-preflight] no products matched selection')
    return
  }

  console.log(
    `[pricing-preflight] preview of computed migration values (first ${Math.min(
      maxProducts,
      previews.length,
    )} products)`,
  )

  for (const preview of previews.slice(0, maxProducts)) {
    const modeLabel = preview.pricingMode
    const basePeriod = preview.basePeriodMinutes ?? 'n/a'
    console.log(
      `- product=${preview.productId} store=${preview.storeId} mode=${modeLabel} base=${preview.basePrice.toFixed(2)} period=${basePeriod}m`,
    )
    for (const tier of preview.computedTiers) {
      console.log(
        `  tier=${tier.tierId} => ${tier.price.toFixed(2)} / ${tier.period}m (legacy: minDuration=${tier.minDuration}, discount=${tier.discountPercent}%)`,
      )
    }
  }
}

async function maybeWriteJson(
  outputPath: string | undefined,
  payload: object,
): Promise<void> {
  if (!outputPath) return
  const targetPath = path.resolve(outputPath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`[pricing-preflight] wrote report to ${targetPath}`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const { env } = (await import('../env')) as typeof import('../env')
  const connection = await mysql.createConnection(env.DATABASE_URL)

  try {
    const products = await fetchProducts(connection, options)
    const tiers = await fetchTiers(
      connection,
      products.map((product) => product.id),
    )

    const tiersByProduct = new Map<string, TierRow[]>()
    for (const tier of tiers) {
      const current = tiersByProduct.get(tier.productId)
      if (current) {
        current.push(tier)
      } else {
        tiersByProduct.set(tier.productId, [tier])
      }
    }

    const issues: PreflightIssue[] = []
    const previews: ProductPreview[] = []
    const report: PreflightReport = {
      productsScanned: 0,
      productsReady: 0,
      productsWithWarnings: 0,
      productsWithBlockers: 0,
      tiersScanned: 0,
      tiersComputed: 0,
      tiersSkipped: 0,
      warningCount: 0,
      blockerCount: 0,
    }

    for (const product of products) {
      report.productsScanned += 1

      const pricingMode = toPricingMode(product.pricingMode)
      const basePeriodMinutes = pricingModeToMinutes(product.pricingMode)
      const basePrice = toNumber(product.price)
      const productTiers = tiersByProduct.get(product.id) ?? []
      report.tiersScanned += productTiers.length

      const productIssueCountAtStart = issues.length
      const computedTiers: ComputedTier[] = []

      if (!pricingMode || !basePeriodMinutes) {
        addIssue(issues, report, {
          severity: 'blocker',
          code: 'invalid_pricing_mode',
          productId: product.id,
          message: `Unknown pricing_mode "${product.pricingMode}"`,
        })
      }

      if (!Number.isFinite(basePrice) || basePrice < 0) {
        addIssue(issues, report, {
          severity: 'blocker',
          code: 'invalid_base_price',
          productId: product.id,
          message: `Invalid base price "${product.price}"`,
        })
      }

      for (const tier of productTiers) {
        const minDuration = tier.minDuration
        const discountPercent = toNumber(tier.discountPercent)

        if (
          typeof minDuration !== 'number' ||
          minDuration <= 0 ||
          !Number.isInteger(minDuration)
        ) {
          report.tiersSkipped += 1
          addIssue(issues, report, {
            severity: 'blocker',
            code: 'invalid_tier_min_duration',
            productId: product.id,
            tierId: tier.id,
            message: `Invalid min_duration "${tier.minDuration}"`,
          })
          continue
        }

        if (tier.discountPercent === null || tier.discountPercent === undefined) {
          report.tiersSkipped += 1
          addIssue(issues, report, {
            severity: 'blocker',
            code: 'missing_tier_legacy_fields',
            productId: product.id,
            tierId: tier.id,
            message: 'discount_percent is required to compute migrated tier price',
          })
          continue
        }

        if (
          !Number.isFinite(discountPercent) ||
          discountPercent < 0 ||
          discountPercent >= 100
        ) {
          report.tiersSkipped += 1
          addIssue(issues, report, {
            severity: 'blocker',
            code: 'invalid_tier_discount_percent',
            productId: product.id,
            tierId: tier.id,
            message: `Invalid discount_percent "${tier.discountPercent}"`,
          })
          continue
        }

        if (!Number.isFinite(basePrice) || basePrice < 0 || !basePeriodMinutes) {
          report.tiersSkipped += 1
          continue
        }

        const period = minDuration * basePeriodMinutes
        const price = roundCurrency(
          basePrice * (1 - discountPercent / 100) * minDuration,
        )

        if (!Number.isFinite(price) || price < 0 || period <= 0) {
          report.tiersSkipped += 1
          addIssue(issues, report, {
            severity: 'blocker',
            code: 'invalid_tier_discount_percent',
            productId: product.id,
            tierId: tier.id,
            message: 'Computed tier values are invalid',
          })
          continue
        }

        report.tiersComputed += 1
        computedTiers.push({
          tierId: tier.id,
          minDuration,
          discountPercent,
          displayOrder: tier.displayOrder ?? 0,
          period,
          price,
        })
      }

      const duplicatePeriodMap = new Map<number, string[]>()
      for (const tier of computedTiers) {
        const existing = duplicatePeriodMap.get(tier.period)
        if (existing) {
          existing.push(tier.tierId)
        } else {
          duplicatePeriodMap.set(tier.period, [tier.tierId])
        }
      }

      for (const [period, tierIds] of duplicatePeriodMap.entries()) {
        if (tierIds.length < 2) continue
        addIssue(issues, report, {
          severity: 'blocker',
          code: 'duplicate_computed_period',
          productId: product.id,
          message: `Multiple tiers compute to period=${period}m: ${tierIds.join(', ')}`,
        })
      }

      if (Number.isFinite(basePrice) && basePrice > 0 && basePeriodMinutes) {
        const basePerMinute = basePrice / basePeriodMinutes
        const sortedByPeriod = [...computedTiers].sort((a, b) => a.period - b.period)

        for (const tier of sortedByPeriod) {
          const tierPerMinute = tier.price / tier.period
          if (tierPerMinute > basePerMinute + 1e-8) {
            addIssue(issues, report, {
              severity: 'warning',
              code: 'tier_more_expensive_than_base',
              productId: product.id,
              tierId: tier.tierId,
              message: `Tier is more expensive per minute than base rate (period=${tier.period}m)`,
            })
          }
        }

        for (let i = 1; i < sortedByPeriod.length; i += 1) {
          const prev = sortedByPeriod[i - 1]
          const current = sortedByPeriod[i]
          const prevPerMinute = prev.price / prev.period
          const currentPerMinute = current.price / current.period
          if (currentPerMinute > prevPerMinute + 1e-8) {
            addIssue(issues, report, {
              severity: 'warning',
              code: 'non_progressive_rate',
              productId: product.id,
              tierId: current.tierId,
              message: `Tier ${current.tierId} is less discounted per minute than previous period tier`,
            })
          }
        }
      }

      const productIssues = issues.slice(productIssueCountAtStart)
      const productBlockers = productIssues.filter(
        (issue) => issue.severity === 'blocker',
      )
      const productWarnings = productIssues.filter(
        (issue) => issue.severity === 'warning',
      )

      if (productBlockers.length > 0) {
        report.productsWithBlockers += 1
      } else {
        report.productsReady += 1
      }

      if (productWarnings.length > 0) {
        report.productsWithWarnings += 1
      }

      previews.push({
        productId: product.id,
        storeId: product.storeId,
        pricingMode: pricingMode ?? product.pricingMode,
        basePrice: Number.isFinite(basePrice) ? basePrice : Number.NaN,
        basePeriodMinutes,
        computedTiers: computedTiers.sort((a, b) => a.period - b.period),
      })
    }

    console.log(
      `[pricing-preflight] checked products=${report.productsScanned} tiers=${report.tiersScanned}`,
    )
    console.table(report)

    if (issues.length > 0) {
      console.log('[pricing-preflight] issue sample (first 30)')
      console.table(issues.slice(0, 30))
    } else {
      console.log('[pricing-preflight] no issues found')
    }

    printPreview(previews, options.previewProducts)

    await maybeWriteJson(options.outputJson, {
      generatedAt: new Date().toISOString(),
      options,
      report,
      issues,
      products: previews,
    })

    if (options.failOnBlockers && report.blockerCount > 0) {
      process.exit(1)
    }

    process.exit(0)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error('[pricing-preflight] failed')
  console.error(error)
  process.exit(1)
})
