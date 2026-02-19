import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import mysql, { type RowDataPacket } from 'mysql2/promise'

type PricingMode = 'hour' | 'day' | 'week'

type CliOptions = {
  apply: boolean
  storeId?: string
  productId?: string
  limit?: number
}

type ProductModeRow = RowDataPacket & {
  productId: string
  storeId: string
  currentPricingMode: string | null
  storePricingMode: string | null
}

type FixReport = {
  productsScanned: number
  productsAlreadyValid: number
  productsFixableFromStore: number
  productsFixableFromDefault: number
  productsUpdated: number
}

function printUsage(): void {
  console.log(`Usage:
  pnpm pricing:fix-pricing-mode -- --dry-run
  pnpm pricing:fix-pricing-mode -- --apply
  pnpm pricing:fix-pricing-mode -- --dry-run --store-id <storeId>
  pnpm pricing:fix-pricing-mode -- --apply --product-id <productId>
  pnpm pricing:fix-pricing-mode -- --apply --limit <count>
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

function toPricingMode(value: string | null | undefined): PricingMode | null {
  if (value === 'hour' || value === 'day' || value === 'week') {
    return value
  }
  return null
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const { env } = (await import('../env')) as typeof import('../env')
  const connection = await mysql.createConnection(env.DATABASE_URL)

  try {
    const whereParts: string[] = []
    const params: Array<string | number> = []

    if (options.storeId) {
      whereParts.push('p.store_id = ?')
      params.push(options.storeId)
    }
    if (options.productId) {
      whereParts.push('p.id = ?')
      params.push(options.productId)
    }

    let query = `
      SELECT
        p.id AS productId,
        p.store_id AS storeId,
        p.pricing_mode AS currentPricingMode,
        JSON_UNQUOTE(JSON_EXTRACT(s.settings, '$.pricingMode')) AS storePricingMode
      FROM products p
      LEFT JOIN stores s ON s.id = p.store_id
    `

    if (whereParts.length > 0) {
      query += ` WHERE ${whereParts.join(' AND ')}`
    }

    query += ' ORDER BY p.id'
    if (options.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    const [rows] = await connection.query<ProductModeRow[]>(query, params)

    const report: FixReport = {
      productsScanned: 0,
      productsAlreadyValid: 0,
      productsFixableFromStore: 0,
      productsFixableFromDefault: 0,
      productsUpdated: 0,
    }

    const updateCandidates: Array<{
      productId: string
      currentPricingMode: string | null
      resolvedPricingMode: PricingMode
      source: 'store' | 'default'
    }> = []

    for (const row of rows) {
      report.productsScanned += 1
      const currentMode = toPricingMode(row.currentPricingMode)
      if (currentMode) {
        report.productsAlreadyValid += 1
        continue
      }

      const storeMode = toPricingMode(row.storePricingMode)
      const resolvedMode: PricingMode = storeMode ?? 'day'
      const source: 'store' | 'default' = storeMode ? 'store' : 'default'

      if (source === 'store') {
        report.productsFixableFromStore += 1
      } else {
        report.productsFixableFromDefault += 1
      }

      updateCandidates.push({
        productId: row.productId,
        currentPricingMode: row.currentPricingMode,
        resolvedPricingMode: resolvedMode,
        source,
      })
    }

    console.log(
      `[pricing-fix-pricing-mode] mode=${options.apply ? 'apply' : 'dry-run'} products=${rows.length}`,
    )
    console.table(report)

    if (updateCandidates.length > 0) {
      console.log('[pricing-fix-pricing-mode] update sample (first 30)')
      console.table(updateCandidates.slice(0, 30))
    } else {
      console.log('[pricing-fix-pricing-mode] no updates needed')
    }

    if (options.apply) {
      for (const candidate of updateCandidates) {
        await connection.query(
          `UPDATE products SET pricing_mode = ?, updated_at = NOW() WHERE id = ?`,
          [candidate.resolvedPricingMode, candidate.productId],
        )
        report.productsUpdated += 1
      }
      console.log('[pricing-fix-pricing-mode] updates applied')
      console.table(report)
    }

    process.exit(0)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error('[pricing-fix-pricing-mode] failed')
  console.error(error)
  process.exit(1)
})
