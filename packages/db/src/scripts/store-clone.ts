import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { nanoid } from 'nanoid'

type CloneScope = 'catalog' | 'full'

type CliOptions = {
  apply: boolean
  scope: CloneScope
  sourceStoreId?: string
  sourceDbUrl?: string
  targetDbUrl?: string
  targetStoreId?: string
  targetStoreSlug?: string
  targetStoreName?: string
  ownerUserId?: string
}

type CloneTable =
  | 'stores'
  | 'store_members'
  | 'categories'
  | 'products'
  | 'product_pricing_tiers'
  | 'product_units'
  | 'product_accessories'
  | 'inspection_templates'
  | 'inspection_template_fields'
  | 'customers'
  | 'reservations'
  | 'reservation_items'
  | 'reservation_item_units'
  | 'payments'
  | 'documents'
  | 'reservation_activity'
  | 'email_logs'
  | 'sms_logs'
  | 'discord_logs'
  | 'sms_credits'
  | 'sms_topup_transactions'
  | 'review_request_logs'
  | 'reminder_logs'
  | 'page_views'
  | 'storefront_events'
  | 'daily_stats'
  | 'product_stats'
  | 'inspections'
  | 'inspection_items'
  | 'inspection_field_values'
  | 'inspection_photos'

type SourceRow = Record<string, unknown>
type Dataset = Partial<Record<CloneTable, SourceRow[]>>

type TransformContext = {
  scope: CloneScope
  sourceStoreId: string
  targetStoreId: string
  targetStoreSlug: string
  targetStoreName: string
  ownerUserId: string
  idMaps: Partial<Record<CloneTable, Map<string, string>>>
}

type TransformResult = {
  rows: Dataset
  skippedByTable: Partial<Record<CloneTable, number>>
  skippedDetails: string[]
}

const SOURCE_BATCH_SIZE = 500
const INSERT_BATCH_SIZE = 250
const MAX_SKIP_DETAILS = 30

const CATALOG_TABLE_ORDER: CloneTable[] = [
  'stores',
  'store_members',
  'categories',
  'products',
  'product_pricing_tiers',
  'product_units',
  'product_accessories',
  'inspection_templates',
  'inspection_template_fields',
]

const FULL_TABLE_ORDER: CloneTable[] = [
  ...CATALOG_TABLE_ORDER,
  'customers',
  'reservations',
  'reservation_items',
  'reservation_item_units',
  'payments',
  'documents',
  'reservation_activity',
  'email_logs',
  'sms_logs',
  'discord_logs',
  'sms_credits',
  'sms_topup_transactions',
  'review_request_logs',
  'reminder_logs',
  'page_views',
  'storefront_events',
  'daily_stats',
  'product_stats',
  'inspections',
  'inspection_items',
  'inspection_field_values',
  'inspection_photos',
]

function printUsage(): void {
  console.log(`Usage:
  pnpm store:clone -- --source-store-id <storeId> --source-db-url <url> [--dry-run]
  pnpm store:clone -- --source-store-id <storeId> --source-db-url <url> --apply

Options:
  --source-store-id <id>     Source store ID from production (required)
  --source-db-url <url>      Source DB URL (or SOURCE_DATABASE_URL env)
  --target-db-url <url>      Target DB URL (or TARGET_DATABASE_URL / DATABASE_URL env)
  --target-store-id <id>     Target store ID (default: generated nanoid)
  --target-store-slug <slug> Target slug (default: source slug + "-dev-xxxxxx")
  --target-store-name <name> Target store name (default: "<source> (Dev Clone)")
  --owner-user-id <id>       Owner user ID in target DB (default: source owner user_id)
  --scope <catalog|full>     Data scope (default: catalog)
  --dry-run                  Build preview report without writing (default)
  --apply                    Execute clone in target DB transaction
  --help, -h                 Show this message

Notes:
  - IDs are regenerated for cloned rows so reruns don't collide with prior clones.
  - "full" scope intentionally skips auth/session token tables (customer_sessions, verification_codes).
  - Stripe and webhook integration fields are reset on the cloned store for safety.
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    scope: 'catalog',
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

    if (arg === '--apply') {
      options.apply = true
      continue
    }

    if (arg === '--dry-run') {
      options.apply = false
      continue
    }

    if (arg === '--source-store-id') {
      options.sourceStoreId = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--source-db-url') {
      options.sourceDbUrl = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--target-db-url') {
      options.targetDbUrl = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--target-store-id') {
      options.targetStoreId = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--target-store-slug') {
      options.targetStoreSlug = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--target-store-name') {
      options.targetStoreName = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--owner-user-id') {
      options.ownerUserId = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--scope') {
      const value = argv[i + 1]
      if (value === 'catalog' || value === 'full') {
        options.scope = value
      } else {
        console.warn(`Unknown scope ignored: ${value}`)
      }
      i += 1
      continue
    }

    console.warn(`Unknown argument ignored: ${arg}`)
  }

  return options
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

function normalizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized.length > 0 ? normalized : 'store'
}

function buildDefaultTargetSlug(sourceSlug: string, targetStoreId: string): string {
  const suffix = `dev-${targetStoreId.slice(-6).toLowerCase()}`
  const maxBaseLength = Math.max(1, 100 - suffix.length - 1)
  const base = normalizeSlug(sourceSlug).slice(0, maxBaseLength)
  return `${base}-${suffix}`
}

function toSourceRows(rows: RowDataPacket[]): SourceRow[] {
  return rows.map((row) => ({ ...row }))
}

function asId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  return null
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

async function fetchRows(
  connection: Connection,
  query: string,
  params: unknown[] = [],
): Promise<SourceRow[]> {
  const [rows] = await connection.query<RowDataPacket[]>(query, params)
  return toSourceRows(rows)
}

async function fetchByIds(
  connection: Connection,
  table: string,
  column: string,
  ids: string[],
): Promise<SourceRow[]> {
  if (ids.length === 0) {
    return []
  }

  const batches = chunk(ids, SOURCE_BATCH_SIZE)
  const output: SourceRow[] = []

  for (const batch of batches) {
    const placeholders = batch.map(() => '?').join(', ')
    const query = `SELECT * FROM \`${table}\` WHERE \`${column}\` IN (${placeholders})`
    output.push(...(await fetchRows(connection, query, batch)))
  }

  return output
}

async function fetchInspectionPhotos(
  connection: Connection,
  inspectionItemIds: string[],
  fieldValueIds: string[],
): Promise<SourceRow[]> {
  const rowsByItem = await fetchByIds(
    connection,
    'inspection_photos',
    'inspection_item_id',
    inspectionItemIds,
  )

  if (fieldValueIds.length === 0) {
    return rowsByItem
  }

  const rowsByFieldValue = await fetchByIds(
    connection,
    'inspection_photos',
    'field_value_id',
    fieldValueIds,
  )

  const merged = new Map<string, SourceRow>()
  for (const row of [...rowsByItem, ...rowsByFieldValue]) {
    const id = asId(row.id)
    if (id) {
      merged.set(id, row)
    }
  }

  return Array.from(merged.values())
}

async function collectDataset(
  sourceConnection: Connection,
  sourceStoreId: string,
  scope: CloneScope,
): Promise<Dataset> {
  const dataset: Dataset = {}

  const sourceStoreRows = await fetchRows(
    sourceConnection,
    'SELECT * FROM stores WHERE id = ? LIMIT 1',
    [sourceStoreId],
  )
  dataset.stores = sourceStoreRows

  dataset.categories = await fetchRows(
    sourceConnection,
    'SELECT * FROM categories WHERE store_id = ?',
    [sourceStoreId],
  )

  dataset.products = await fetchRows(
    sourceConnection,
    'SELECT * FROM products WHERE store_id = ?',
    [sourceStoreId],
  )

  const productIds = uniqueIds(dataset.products.map((row) => asId(row.id)))
  dataset.product_pricing_tiers = await fetchByIds(
    sourceConnection,
    'product_pricing_tiers',
    'product_id',
    productIds,
  )
  dataset.product_units = await fetchByIds(sourceConnection, 'product_units', 'product_id', productIds)

  if (productIds.length > 0) {
    const productPlaceholders = productIds.map(() => '?').join(', ')
    dataset.product_accessories = await fetchRows(
      sourceConnection,
      `
        SELECT *
        FROM product_accessories
        WHERE product_id IN (${productPlaceholders})
          AND accessory_id IN (${productPlaceholders})
      `,
      [...productIds, ...productIds],
    )
  } else {
    dataset.product_accessories = []
  }

  dataset.inspection_templates = await fetchRows(
    sourceConnection,
    'SELECT * FROM inspection_templates WHERE store_id = ?',
    [sourceStoreId],
  )
  const inspectionTemplateIds = uniqueIds(
    dataset.inspection_templates.map((row) => asId(row.id)),
  )
  dataset.inspection_template_fields = await fetchByIds(
    sourceConnection,
    'inspection_template_fields',
    'template_id',
    inspectionTemplateIds,
  )

  if (scope === 'catalog') {
    return dataset
  }

  dataset.customers = await fetchRows(
    sourceConnection,
    'SELECT * FROM customers WHERE store_id = ?',
    [sourceStoreId],
  )

  dataset.reservations = await fetchRows(
    sourceConnection,
    'SELECT * FROM reservations WHERE store_id = ?',
    [sourceStoreId],
  )
  const reservationIds = uniqueIds(dataset.reservations.map((row) => asId(row.id)))

  dataset.reservation_items = await fetchByIds(
    sourceConnection,
    'reservation_items',
    'reservation_id',
    reservationIds,
  )
  const reservationItemIds = uniqueIds(dataset.reservation_items.map((row) => asId(row.id)))

  dataset.reservation_item_units = await fetchByIds(
    sourceConnection,
    'reservation_item_units',
    'reservation_item_id',
    reservationItemIds,
  )
  dataset.payments = await fetchByIds(sourceConnection, 'payments', 'reservation_id', reservationIds)
  dataset.documents = await fetchByIds(sourceConnection, 'documents', 'reservation_id', reservationIds)
  dataset.reservation_activity = await fetchByIds(
    sourceConnection,
    'reservation_activity',
    'reservation_id',
    reservationIds,
  )

  dataset.email_logs = await fetchRows(
    sourceConnection,
    'SELECT * FROM email_logs WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.sms_logs = await fetchRows(
    sourceConnection,
    'SELECT * FROM sms_logs WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.discord_logs = await fetchRows(
    sourceConnection,
    'SELECT * FROM discord_logs WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.sms_credits = await fetchRows(
    sourceConnection,
    'SELECT * FROM sms_credits WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.sms_topup_transactions = await fetchRows(
    sourceConnection,
    'SELECT * FROM sms_topup_transactions WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.review_request_logs = await fetchRows(
    sourceConnection,
    'SELECT * FROM review_request_logs WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.reminder_logs = await fetchRows(
    sourceConnection,
    'SELECT * FROM reminder_logs WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.page_views = await fetchRows(
    sourceConnection,
    'SELECT * FROM page_views WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.storefront_events = await fetchRows(
    sourceConnection,
    'SELECT * FROM storefront_events WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.daily_stats = await fetchRows(
    sourceConnection,
    'SELECT * FROM daily_stats WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.product_stats = await fetchRows(
    sourceConnection,
    'SELECT * FROM product_stats WHERE store_id = ?',
    [sourceStoreId],
  )
  dataset.inspections = await fetchRows(
    sourceConnection,
    'SELECT * FROM inspections WHERE store_id = ?',
    [sourceStoreId],
  )

  const inspectionIds = uniqueIds(dataset.inspections.map((row) => asId(row.id)))
  dataset.inspection_items = await fetchByIds(
    sourceConnection,
    'inspection_items',
    'inspection_id',
    inspectionIds,
  )

  const inspectionItemIds = uniqueIds(dataset.inspection_items.map((row) => asId(row.id)))
  dataset.inspection_field_values = await fetchByIds(
    sourceConnection,
    'inspection_field_values',
    'inspection_item_id',
    inspectionItemIds,
  )

  const inspectionFieldValueIds = uniqueIds(
    dataset.inspection_field_values.map((row) => asId(row.id)),
  )

  dataset.inspection_photos = await fetchInspectionPhotos(
    sourceConnection,
    inspectionItemIds,
    inspectionFieldValueIds,
  )

  return dataset
}

function registerIdMap(
  dataset: Dataset,
  sourceStoreId: string,
  targetStoreId: string,
): Partial<Record<CloneTable, Map<string, string>>> {
  const idMaps: Partial<Record<CloneTable, Map<string, string>>> = {
    stores: new Map([[sourceStoreId, targetStoreId]]),
  }

  for (const [tableName, tableRows] of Object.entries(dataset) as Array<
    [CloneTable, SourceRow[] | undefined]
  >) {
    if (tableName === 'stores') {
      continue
    }

    if (!tableRows || tableRows.length === 0) {
      idMaps[tableName] = new Map()
      continue
    }

    const map = new Map<string, string>()
    for (const row of tableRows) {
      const rowId = asId(row.id)
      if (!rowId) {
        continue
      }
      map.set(rowId, nanoid())
    }
    idMaps[tableName] = map
  }

  return idMaps
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed }
      }
      return null
    } catch {
      return null
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }

  return null
}

function sanitizeStoreSettings(value: unknown): unknown {
  const parsed = parseJsonObject(value)
  if (!parsed) {
    return value
  }

  delete parsed.integration_data
  delete parsed.integrationData
  return parsed
}

function addSkip(
  table: CloneTable,
  rowId: string | null,
  reason: string,
  skippedByTable: Partial<Record<CloneTable, number>>,
  skippedDetails: string[],
): void {
  skippedByTable[table] = (skippedByTable[table] ?? 0) + 1
  if (skippedDetails.length < MAX_SKIP_DETAILS) {
    skippedDetails.push(
      `${table}${rowId ? `#${rowId}` : ''}: ${reason}`,
    )
  }
}

function transformDataset(dataset: Dataset, context: TransformContext): TransformResult {
  const output: Dataset = {}
  const skippedByTable: Partial<Record<CloneTable, number>> = {}
  const skippedDetails: string[] = []

  const mapId = (table: CloneTable, idValue: unknown): string | null => {
    const sourceId = asId(idValue)
    if (!sourceId) {
      return null
    }
    const map = context.idMaps[table]
    return map?.get(sourceId) ?? null
  }

  const mapOptionalRef = (table: CloneTable, value: unknown): string | null => {
    const sourceId = asId(value)
    if (!sourceId) {
      return null
    }
    return mapId(table, sourceId)
  }

  const mapRequiredRef = (
    targetTable: CloneTable,
    rowId: string | null,
    fieldName: string,
    refTable: CloneTable,
    value: unknown,
  ): string | null => {
    const mapped = mapOptionalRef(refTable, value)
    if (mapped) {
      return mapped
    }
    addSkip(
      targetTable,
      rowId,
      `missing mapped reference for ${fieldName}`,
      skippedByTable,
      skippedDetails,
    )
    return null
  }

  const transformRows = (
    table: CloneTable,
    rows: SourceRow[] | undefined,
  ): SourceRow[] => {
    if (!rows || rows.length === 0) {
      return []
    }

    const transformedRows: SourceRow[] = []

    for (const sourceRow of rows) {
      const row = { ...sourceRow }
      const sourceRowId = asId(sourceRow.id)

      if (table !== 'store_members') {
        const mappedId = mapId(table, sourceRow.id)
        if (!mappedId) {
          addSkip(
            table,
            sourceRowId,
            'missing mapped id',
            skippedByTable,
            skippedDetails,
          )
          continue
        }
        row.id = mappedId
      }

      if ('store_id' in row) {
        row.store_id = context.targetStoreId
      }

      if (table === 'stores') {
        row.id = context.targetStoreId
        row.user_id = context.ownerUserId
        row.slug = context.targetStoreSlug
        row.name = context.targetStoreName
        row.referral_code = null
        row.referred_by_user_id = null
        row.referred_by_store_id = null
        row.ics_token = null
        row.settings = sanitizeStoreSettings(row.settings)
        row.stripe_account_id = null
        row.stripe_onboarding_complete = false
        row.stripe_charges_enabled = false
        row.stripe_coupon_id = null
        row.discord_webhook_url = null
        row.updated_at = new Date()
        transformedRows.push(row)
        continue
      }

      if (table === 'categories') {
        transformedRows.push(row)
        continue
      }

      if (table === 'products') {
        row.category_id = mapOptionalRef('categories', row.category_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'product_pricing_tiers') {
        const mappedProductId = mapRequiredRef(
          table,
          sourceRowId,
          'product_id',
          'products',
          row.product_id,
        )
        if (!mappedProductId) {
          continue
        }
        row.product_id = mappedProductId
        transformedRows.push(row)
        continue
      }

      if (table === 'product_units') {
        const mappedProductId = mapRequiredRef(
          table,
          sourceRowId,
          'product_id',
          'products',
          row.product_id,
        )
        if (!mappedProductId) {
          continue
        }
        row.product_id = mappedProductId
        transformedRows.push(row)
        continue
      }

      if (table === 'product_accessories') {
        const mappedProductId = mapRequiredRef(
          table,
          sourceRowId,
          'product_id',
          'products',
          row.product_id,
        )
        const mappedAccessoryId = mapRequiredRef(
          table,
          sourceRowId,
          'accessory_id',
          'products',
          row.accessory_id,
        )
        if (!mappedProductId || !mappedAccessoryId) {
          continue
        }
        row.product_id = mappedProductId
        row.accessory_id = mappedAccessoryId
        transformedRows.push(row)
        continue
      }

      if (table === 'inspection_templates') {
        row.category_id = mapOptionalRef('categories', row.category_id)
        row.product_id = mapOptionalRef('products', row.product_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'inspection_template_fields') {
        const mappedTemplateId = mapRequiredRef(
          table,
          sourceRowId,
          'template_id',
          'inspection_templates',
          row.template_id,
        )
        if (!mappedTemplateId) {
          continue
        }
        row.template_id = mappedTemplateId
        transformedRows.push(row)
        continue
      }

      if (table === 'customers') {
        transformedRows.push(row)
        continue
      }

      if (table === 'reservations') {
        const mappedCustomerId = mapRequiredRef(
          table,
          sourceRowId,
          'customer_id',
          'customers',
          row.customer_id,
        )
        if (!mappedCustomerId) {
          continue
        }
        row.customer_id = mappedCustomerId
        transformedRows.push(row)
        continue
      }

      if (table === 'reservation_items') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        if (!mappedReservationId) {
          continue
        }
        row.reservation_id = mappedReservationId
        row.product_id = mapOptionalRef('products', row.product_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'reservation_item_units') {
        const mappedReservationItemId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_item_id',
          'reservation_items',
          row.reservation_item_id,
        )
        const mappedProductUnitId = mapRequiredRef(
          table,
          sourceRowId,
          'product_unit_id',
          'product_units',
          row.product_unit_id,
        )
        if (!mappedReservationItemId || !mappedProductUnitId) {
          continue
        }
        row.reservation_item_id = mappedReservationItemId
        row.product_unit_id = mappedProductUnitId
        transformedRows.push(row)
        continue
      }

      if (table === 'payments') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        if (!mappedReservationId) {
          continue
        }
        row.reservation_id = mappedReservationId
        transformedRows.push(row)
        continue
      }

      if (table === 'documents') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        if (!mappedReservationId) {
          continue
        }
        row.reservation_id = mappedReservationId
        transformedRows.push(row)
        continue
      }

      if (table === 'reservation_activity') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        if (!mappedReservationId) {
          continue
        }
        row.reservation_id = mappedReservationId
        row.user_id = row.user_id ? context.ownerUserId : null
        transformedRows.push(row)
        continue
      }

      if (table === 'email_logs') {
        row.reservation_id = mapOptionalRef('reservations', row.reservation_id)
        row.customer_id = mapOptionalRef('customers', row.customer_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'sms_logs') {
        row.reservation_id = mapOptionalRef('reservations', row.reservation_id)
        row.customer_id = mapOptionalRef('customers', row.customer_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'discord_logs') {
        row.reservation_id = mapOptionalRef('reservations', row.reservation_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'sms_credits') {
        transformedRows.push(row)
        continue
      }

      if (table === 'sms_topup_transactions') {
        transformedRows.push(row)
        continue
      }

      if (table === 'review_request_logs') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        const mappedCustomerId = mapRequiredRef(
          table,
          sourceRowId,
          'customer_id',
          'customers',
          row.customer_id,
        )
        if (!mappedReservationId || !mappedCustomerId) {
          continue
        }
        row.reservation_id = mappedReservationId
        row.customer_id = mappedCustomerId
        transformedRows.push(row)
        continue
      }

      if (table === 'reminder_logs') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        const mappedCustomerId = mapRequiredRef(
          table,
          sourceRowId,
          'customer_id',
          'customers',
          row.customer_id,
        )
        if (!mappedReservationId || !mappedCustomerId) {
          continue
        }
        row.reservation_id = mappedReservationId
        row.customer_id = mappedCustomerId
        transformedRows.push(row)
        continue
      }

      if (table === 'page_views') {
        row.product_id = mapOptionalRef('products', row.product_id)
        row.category_id = mapOptionalRef('categories', row.category_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'storefront_events') {
        row.customer_id = mapOptionalRef('customers', row.customer_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'daily_stats') {
        transformedRows.push(row)
        continue
      }

      if (table === 'product_stats') {
        const mappedProductId = mapRequiredRef(
          table,
          sourceRowId,
          'product_id',
          'products',
          row.product_id,
        )
        if (!mappedProductId) {
          continue
        }
        row.product_id = mappedProductId
        transformedRows.push(row)
        continue
      }

      if (table === 'inspections') {
        const mappedReservationId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_id',
          'reservations',
          row.reservation_id,
        )
        if (!mappedReservationId) {
          continue
        }
        row.reservation_id = mappedReservationId
        row.template_id = mapOptionalRef('inspection_templates', row.template_id)
        row.damage_payment_id = mapOptionalRef('payments', row.damage_payment_id)
        row.performed_by_id = row.performed_by_id ? context.ownerUserId : null
        transformedRows.push(row)
        continue
      }

      if (table === 'inspection_items') {
        const mappedInspectionId = mapRequiredRef(
          table,
          sourceRowId,
          'inspection_id',
          'inspections',
          row.inspection_id,
        )
        const mappedReservationItemId = mapRequiredRef(
          table,
          sourceRowId,
          'reservation_item_id',
          'reservation_items',
          row.reservation_item_id,
        )
        if (!mappedInspectionId || !mappedReservationItemId) {
          continue
        }
        row.inspection_id = mappedInspectionId
        row.reservation_item_id = mappedReservationItemId
        row.product_unit_id = mapOptionalRef('product_units', row.product_unit_id)
        transformedRows.push(row)
        continue
      }

      if (table === 'inspection_field_values') {
        const mappedInspectionItemId = mapRequiredRef(
          table,
          sourceRowId,
          'inspection_item_id',
          'inspection_items',
          row.inspection_item_id,
        )
        const mappedTemplateFieldId = mapRequiredRef(
          table,
          sourceRowId,
          'template_field_id',
          'inspection_template_fields',
          row.template_field_id,
        )
        if (!mappedInspectionItemId || !mappedTemplateFieldId) {
          continue
        }
        row.inspection_item_id = mappedInspectionItemId
        row.template_field_id = mappedTemplateFieldId
        transformedRows.push(row)
        continue
      }

      if (table === 'inspection_photos') {
        const mappedInspectionItemId = mapRequiredRef(
          table,
          sourceRowId,
          'inspection_item_id',
          'inspection_items',
          row.inspection_item_id,
        )
        if (!mappedInspectionItemId) {
          continue
        }
        row.inspection_item_id = mappedInspectionItemId
        row.field_value_id = mapOptionalRef('inspection_field_values', row.field_value_id)
        transformedRows.push(row)
        continue
      }

      transformedRows.push(row)
    }

    return transformedRows
  }

  const tables = context.scope === 'full' ? FULL_TABLE_ORDER : CATALOG_TABLE_ORDER
  for (const table of tables) {
    if (table === 'store_members') {
      output.store_members = [
        {
          id: nanoid(),
          store_id: context.targetStoreId,
          user_id: context.ownerUserId,
          role: 'owner',
          is_owner: true,
          added_by: context.ownerUserId,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]
      continue
    }

    output[table] = transformRows(table, dataset[table])
  }

  return {
    rows: output,
    skippedByTable,
    skippedDetails,
  }
}

function normalizeSqlValue(value: unknown): unknown {
  if (value === undefined) {
    return null
  }

  if (value === null) {
    return null
  }

  if (value instanceof Date) {
    return value
  }

  if (Buffer.isBuffer(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return value
}

async function insertRows(
  connection: Connection,
  table: CloneTable,
  rows: SourceRow[],
  tableColumnsCache: Map<CloneTable, Set<string>>,
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  let tableColumns = tableColumnsCache.get(table)
  if (!tableColumns) {
    const [columnRows] = await connection.query<RowDataPacket[]>(
      `
        SELECT COLUMN_NAME AS columnName
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [table],
    )

    tableColumns = new Set(
      columnRows
        .map((row) => (typeof row.columnName === 'string' ? row.columnName : null))
        .filter((column): column is string => !!column),
    )
    tableColumnsCache.set(table, tableColumns)
  }

  if (tableColumns.size === 0) {
    throw new Error(`Target table "${table}" was not found in current database.`)
  }

  const batches = chunk(rows, INSERT_BATCH_SIZE)
  for (const batch of batches) {
    const columns = Object.keys(batch[0] ?? {}).filter((column) => tableColumns.has(column))
    if (columns.length === 0) {
      throw new Error(
        `No compatible columns found for table "${table}". Target schema may be incompatible.`,
      )
    }

    const rowPlaceholders = batch
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ')
    const values = batch.flatMap((row) =>
      columns.map((column) => normalizeSqlValue(row[column])),
    )
    const query = `
      INSERT INTO \`${table}\`
      (${columns.map((column) => `\`${column}\``).join(', ')})
      VALUES ${rowPlaceholders}
    `
    await connection.query(query, values)
  }
}

async function assertTargetStoreAvailable(
  targetConnection: Connection,
  targetStoreId: string,
  targetStoreSlug: string,
): Promise<void> {
  const [idRows] = await targetConnection.query<RowDataPacket[]>(
    'SELECT id FROM stores WHERE id = ? LIMIT 1',
    [targetStoreId],
  )
  if (idRows.length > 0) {
    throw new Error(
      `Target store id "${targetStoreId}" already exists in target DB. Pick another --target-store-id.`,
    )
  }

  const [slugRows] = await targetConnection.query<RowDataPacket[]>(
    'SELECT id FROM stores WHERE slug = ? LIMIT 1',
    [targetStoreSlug],
  )
  if (slugRows.length > 0) {
    throw new Error(
      `Target store slug "${targetStoreSlug}" already exists in target DB. Pick another --target-store-slug.`,
    )
  }
}

async function assertOwnerUserExists(
  targetConnection: Connection,
  ownerUserId: string,
): Promise<void> {
  const [ownerRows] = await targetConnection.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE id = ? LIMIT 1',
    [ownerUserId],
  )
  if (ownerRows.length === 0) {
    throw new Error(
      `Owner user "${ownerUserId}" does not exist in target DB. Provide --owner-user-id with an existing target user id.`,
    )
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (!options.sourceStoreId) {
    console.error('Missing required argument: --source-store-id')
    printUsage()
    process.exit(1)
  }

  const sourceDbUrl = options.sourceDbUrl ?? process.env.SOURCE_DATABASE_URL
  if (!sourceDbUrl) {
    console.error('Missing source DB URL. Provide --source-db-url or SOURCE_DATABASE_URL.')
    process.exit(1)
  }

  let targetDbUrl = options.targetDbUrl ?? process.env.TARGET_DATABASE_URL
  if (!targetDbUrl) {
    const { env } = (await import('../env')) as typeof import('../env')
    targetDbUrl = env.DATABASE_URL
  }

  const sourceConnection = await mysql.createConnection(sourceDbUrl)
  const targetConnection = await mysql.createConnection(targetDbUrl)

  try {
    const dataset = await collectDataset(
      sourceConnection,
      options.sourceStoreId,
      options.scope,
    )
    const sourceStore = dataset.stores?.[0]
    if (!sourceStore) {
      throw new Error(`Store "${options.sourceStoreId}" not found in source database.`)
    }

    const sourceStoreSlug = asId(sourceStore.slug) ?? 'store'
    const sourceStoreName = asId(sourceStore.name) ?? 'Store'
    const sourceOwnerId = asId(sourceStore.user_id)

    if (!sourceOwnerId && !options.ownerUserId) {
      throw new Error(
        'Source store has no user_id and --owner-user-id was not provided.',
      )
    }

    const targetStoreId = options.targetStoreId ?? nanoid()
    const targetStoreSlug = normalizeSlug(
      options.targetStoreSlug ?? buildDefaultTargetSlug(sourceStoreSlug, targetStoreId),
    )
    const targetStoreName = options.targetStoreName ?? `${sourceStoreName} (Dev Clone)`
    const ownerUserId = options.ownerUserId ?? sourceOwnerId ?? ''

    if (targetStoreSlug.length > 100) {
      throw new Error('Target slug exceeds 100 chars. Provide a shorter --target-store-slug.')
    }

    await assertOwnerUserExists(targetConnection, ownerUserId)
    await assertTargetStoreAvailable(targetConnection, targetStoreId, targetStoreSlug)

    const idMaps = registerIdMap(dataset, options.sourceStoreId, targetStoreId)
    const transformed = transformDataset(dataset, {
      scope: options.scope,
      sourceStoreId: options.sourceStoreId,
      targetStoreId,
      targetStoreSlug,
      targetStoreName,
      ownerUserId,
      idMaps,
    })

    const tables = options.scope === 'full' ? FULL_TABLE_ORDER : CATALOG_TABLE_ORDER
    const summary = tables.map((table) => ({
      table,
      sourceRows: dataset[table]?.length ?? (table === 'store_members' ? 1 : 0),
      cloneRows: transformed.rows[table]?.length ?? 0,
      skippedRows: transformed.skippedByTable[table] ?? 0,
    }))

    console.log(
      `[store-clone] mode=${options.apply ? 'apply' : 'dry-run'} scope=${options.scope}`,
    )
    console.log(
      `[store-clone] sourceStore=${options.sourceStoreId} targetStore=${targetStoreId} owner=${ownerUserId}`,
    )
    console.log(
      `[store-clone] targetSlug=${targetStoreSlug} targetName="${targetStoreName}"`,
    )
    console.table(summary)

    if (transformed.skippedDetails.length > 0) {
      console.warn('[store-clone] some rows were skipped due to missing references')
      for (const detail of transformed.skippedDetails) {
        console.warn(`  - ${detail}`)
      }
    }

    if (!options.apply) {
      console.log('[store-clone] dry-run complete (no data written)')
      process.exit(0)
    }

    await targetConnection.beginTransaction()
    try {
      const tableColumnsCache = new Map<CloneTable, Set<string>>()
      for (const table of tables) {
        await insertRows(
          targetConnection,
          table,
          transformed.rows[table] ?? [],
          tableColumnsCache,
        )
      }
      await targetConnection.commit()
    } catch (error) {
      await targetConnection.rollback()
      throw error
    }

    console.log('[store-clone] clone committed successfully')
    console.log(
      `[store-clone] newStoreId=${targetStoreId} newSlug=${targetStoreSlug} scope=${options.scope}`,
    )
    process.exit(0)
  } finally {
    await sourceConnection.end()
    await targetConnection.end()
  }
}

main().catch((error) => {
  console.error('[store-clone] failed')
  console.error(error)
  process.exit(1)
})
