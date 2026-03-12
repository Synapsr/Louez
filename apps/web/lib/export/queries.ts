import { db, reservations, reservationItems, payments, products, categories, customers } from '@louez/db'
import { eq, and, between, asc, desc } from 'drizzle-orm'
import type { ExportParams } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIsoDate(date: Date | null | undefined): string {
  if (!date) return ''
  return date.toISOString()
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const PAYMENT_HEADERS = [
  'Payment ID',
  'Reservation #',
  'Customer',
  'Amount',
  'Type',
  'Method',
  'Status',
  'Currency',
  'Stripe Payment Intent ID',
  'Paid At',
  'Created At',
  'Notes',
]

async function queryPaymentsData(storeId: string, params: ExportParams) {
  const rows = await db
    .select({
      paymentId: payments.id,
      reservationNumber: reservations.number,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      amount: payments.amount,
      type: payments.type,
      method: payments.method,
      status: payments.status,
      currency: payments.currency,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
      notes: payments.notes,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        params.startDate && params.endDate
          ? between(payments.createdAt, params.startDate, params.endDate)
          : undefined
      )
    )
    .orderBy(desc(payments.createdAt))

  return rows
}

function paymentsToRows(data: Awaited<ReturnType<typeof queryPaymentsData>>): string[][] {
  return data.map((row) => [
    str(row.paymentId),
    str(row.reservationNumber),
    [row.customerFirstName, row.customerLastName].filter(Boolean).join(' '),
    str(row.amount),
    str(row.type),
    str(row.method),
    str(row.status),
    str(row.currency),
    str(row.stripePaymentIntentId),
    formatIsoDate(row.paidAt),
    formatIsoDate(row.createdAt),
    str(row.notes),
  ])
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

const RESERVATION_HEADERS = [
  'Reservation #',
  'Status',
  'Customer Name',
  'Customer Email',
  'Customer Phone',
  'Company',
  'Start Date',
  'End Date',
  'Items',
  'Subtotal Excl. Tax',
  'Tax',
  'Deposit',
  'Delivery Fee',
  'Discount',
  'Total',
  'Outbound Method',
  'Return Method',
  'Delivery Address',
  'Customer Notes',
  'Internal Notes',
  'Created At',
]

async function queryReservationsData(storeId: string, params: ExportParams) {
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      params.startDate && params.endDate
        ? between(reservations.createdAt, params.startDate, params.endDate)
        : undefined
    ),
    orderBy: [desc(reservations.createdAt)],
    with: {
      customer: true,
      items: {
        columns: {
          quantity: true,
          productSnapshot: true,
        },
      },
    },
  })

  return rows
}

function formatItemsSummary(
  items: Array<{ quantity: number; productSnapshot: { name: string } | null }>
): string {
  return items
    .map((item) => {
      const name = item.productSnapshot?.name ?? '?'
      return item.quantity > 1 ? `${name} x${item.quantity}` : name
    })
    .join('; ')
}

function formatAddress(reservation: {
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryPostalCode: string | null
  deliveryCountry: string | null
}): string {
  return [
    reservation.deliveryAddress,
    reservation.deliveryPostalCode,
    reservation.deliveryCity,
    reservation.deliveryCountry,
  ]
    .filter(Boolean)
    .join(', ')
}

function reservationsToRows(
  data: Awaited<ReturnType<typeof queryReservationsData>>
): string[][] {
  return data.map((row) => [
    str(row.number),
    str(row.status),
    [row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' '),
    str(row.customer?.email),
    str(row.customer?.phone),
    str(row.customer?.companyName),
    formatIsoDate(row.startDate),
    formatIsoDate(row.endDate),
    formatItemsSummary(row.items),
    str(row.subtotalExclTax ?? row.subtotalAmount),
    str(row.taxAmount),
    str(row.depositAmount),
    str(row.deliveryFee),
    str(row.discountAmount),
    str(row.totalAmount),
    str(row.outboundMethod),
    str(row.returnMethod),
    formatAddress(row),
    str(row.customerNotes),
    str(row.internalNotes),
    formatIsoDate(row.createdAt),
  ])
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_HEADERS = [
  'Name',
  'Category',
  'Price',
  'Deposit',
  'Pricing Mode',
  'Quantity',
  'Status',
  'Created At',
]

async function queryProductsData(storeId: string) {
  const rows = await db
    .select({
      name: products.name,
      categoryName: categories.name,
      price: products.price,
      deposit: products.deposit,
      pricingMode: products.pricingMode,
      quantity: products.quantity,
      status: products.status,
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.storeId, storeId))
    .orderBy(asc(products.name))

  return rows
}

function productsToRows(data: Awaited<ReturnType<typeof queryProductsData>>): string[][] {
  return data.map((row) => [
    str(row.name),
    str(row.categoryName),
    str(row.price),
    str(row.deposit),
    str(row.pricingMode),
    str(row.quantity),
    str(row.status),
    formatIsoDate(row.createdAt),
  ])
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExportData {
  headers: string[]
  rows: string[][]
  json: Record<string, unknown>[]
}

export async function queryExportData(
  storeId: string,
  params: ExportParams
): Promise<ExportData> {
  switch (params.type) {
    case 'payments': {
      const data = await queryPaymentsData(storeId, params)
      return { headers: PAYMENT_HEADERS, rows: paymentsToRows(data), json: data }
    }
    case 'reservations': {
      const data = await queryReservationsData(storeId, params)
      return { headers: RESERVATION_HEADERS, rows: reservationsToRows(data), json: data }
    }
    case 'products': {
      const data = await queryProductsData(storeId)
      return { headers: PRODUCT_HEADERS, rows: productsToRows(data), json: data }
    }
  }
}
