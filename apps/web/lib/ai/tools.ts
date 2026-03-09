import { tool } from 'ai'
import {
  db,
  products,
  categories,
  reservations,
  reservationItems,
  customers,
  payments,
  dailyStats,
  productStats,
  stores,
} from '@louez/db'
import type { ApiKeyPermissions } from '@louez/db/schema'
import { and, eq, like, sql, desc, gte, lte, sum, inArray } from 'drizzle-orm'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Context & permissions
// ---------------------------------------------------------------------------

export type AIChatContext = {
  storeId: string
  storeName: string
  permissions: ApiKeyPermissions
}

function requirePermission(
  ctx: AIChatContext,
  domain: keyof ApiKeyPermissions,
  level: 'read' | 'write',
) {
  const perm = ctx.permissions[domain]
  if (perm === 'none') {
    throw new Error(`Permission denied: requires ${domain}:${level}`)
  }
  if (level === 'write' && perm === 'read') {
    throw new Error(`Permission denied: requires ${domain}:write (current: read)`)
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createAITools(ctx: AIChatContext) {
  return {
    // ── Products ──────────────────────────────────────────────────────────

    list_products: tool({
      description: 'List products in the store catalog with optional filters',
      inputSchema: z.object({
        status: z.enum(['active', 'draft', 'archived', 'all']).optional().describe('Filter by status'),
        categoryId: z.string().optional().describe('Filter by category ID'),
        search: z.string().optional().describe('Search by product name'),
      }),
      execute: async ({ status, categoryId, search }) => {
        requirePermission(ctx, 'products', 'read')

        const conditions = [eq(products.storeId, ctx.storeId)]
        if (status && status !== 'all') conditions.push(eq(products.status, status))
        if (categoryId) conditions.push(eq(products.categoryId, categoryId))
        if (search) conditions.push(like(products.name, `%${search}%`))

        const rows = await db
          .select({
            id: products.id,
            name: products.name,
            price: products.price,
            deposit: products.deposit,
            pricingMode: products.pricingMode,
            quantity: products.quantity,
            status: products.status,
            categoryName: categories.name,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(...conditions))
          .orderBy(products.displayOrder, products.name)
          .limit(50)

        const [countResult] = await db
          .select({ total: sql<number>`COUNT(*)` })
          .from(products)
          .where(and(...conditions))

        return { products: rows, total: countResult?.total ?? 0 }
      },
    }),

    get_product: tool({
      description: 'Get detailed information about a specific product',
      inputSchema: z.object({
        productId: z.string().describe('The product ID'),
      }),
      execute: async ({ productId }) => {
        requirePermission(ctx, 'products', 'read')

        const product = await db.query.products.findFirst({
          where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
          with: { category: true, pricingTiers: true, units: true },
        })

        if (!product) return { error: 'Product not found' }
        return { product }
      },
    }),

    create_product: tool({
      description: 'Create a new product in the catalog',
      inputSchema: z.object({
        name: z.string().min(1).describe('Product name'),
        description: z.string().optional().describe('Product description'),
        price: z.string().describe('Price per period (e.g. "25.00")'),
        deposit: z.string().optional().describe('Deposit amount (e.g. "100.00")'),
        pricingMode: z.enum(['hour', 'day', 'week']).describe('Pricing period'),
        quantity: z.number().int().min(1).optional().describe('Stock quantity (default 1)'),
        categoryId: z.string().optional().describe('Category ID'),
      }),
      execute: async ({ name, description, price, deposit, pricingMode, quantity, categoryId }) => {
        requirePermission(ctx, 'products', 'write')

        const [created] = await db
          .insert(products)
          .values({
            storeId: ctx.storeId,
            name,
            description: description ?? null,
            price,
            deposit: deposit ?? '0',
            pricingMode,
            quantity: quantity ?? 1,
            categoryId: categoryId ?? null,
            status: 'active',
          })
          .$returningId()

        return { id: created.id, name, price, pricingMode, quantity: quantity ?? 1 }
      },
    }),

    update_product: tool({
      description: 'Update an existing product',
      inputSchema: z.object({
        productId: z.string().describe('The product ID to update'),
        name: z.string().optional().describe('New product name'),
        description: z.string().optional().describe('New description'),
        price: z.string().optional().describe('New price'),
        deposit: z.string().optional().describe('New deposit amount'),
        quantity: z.number().int().optional().describe('New stock quantity'),
        status: z.enum(['active', 'draft', 'archived']).optional().describe('New status'),
      }),
      execute: async ({ productId, ...updates }) => {
        requirePermission(ctx, 'products', 'write')

        const existing = await db.query.products.findFirst({
          where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
          columns: { id: true },
        })
        if (!existing) return { error: 'Product not found' }

        const updateData: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateData[key] = value
        }

        if (Object.keys(updateData).length === 0) {
          return { error: 'No fields to update' }
        }

        await db.update(products).set(updateData).where(eq(products.id, productId))
        return { success: true, productId }
      },
    }),

    archive_product: tool({
      description: 'Archive a product (soft delete)',
      inputSchema: z.object({
        productId: z.string().describe('The product ID to archive'),
      }),
      execute: async ({ productId }) => {
        requirePermission(ctx, 'products', 'write')

        const existing = await db.query.products.findFirst({
          where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
          columns: { id: true, name: true },
        })
        if (!existing) return { error: 'Product not found' }

        const [activeCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(reservationItems)
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .where(
            and(
              eq(reservationItems.productId, productId),
              inArray(reservations.status, ['pending', 'confirmed', 'ongoing'] as const),
            ),
          )

        if (activeCount && activeCount.count > 0) {
          return { error: `Cannot archive: ${activeCount.count} active reservation(s) use this product` }
        }

        await db.update(products).set({ status: 'archived' }).where(eq(products.id, productId))
        return { success: true, name: existing.name }
      },
    }),

    // ── Reservations ─────────────────────────────────────────────────────

    list_reservations: tool({
      description: 'List reservations with optional filters (status, period, search)',
      inputSchema: z.object({
        status: z.enum(['pending', 'confirmed', 'ongoing', 'completed', 'cancelled', 'rejected']).optional(),
        period: z.enum(['today', 'week', 'month']).optional(),
        search: z.string().optional().describe('Search by reservation number or customer name'),
      }),
      execute: async ({ status, period, search }) => {
        requirePermission(ctx, 'reservations', 'read')

        const conditions = [eq(reservations.storeId, ctx.storeId)]

        if (status) conditions.push(eq(reservations.status, status))

        if (period) {
          const start = new Date()
          start.setHours(0, 0, 0, 0)
          if (period === 'week') start.setDate(start.getDate() - 7)
          if (period === 'month') start.setMonth(start.getMonth() - 1)
          conditions.push(gte(reservations.createdAt, start))
        }

        if (search) {
          conditions.push(
            sql`(${reservations.number} LIKE ${'%' + search + '%'} OR EXISTS (
              SELECT 1 FROM customers c
              WHERE c.id = ${reservations.customerId}
              AND (LOWER(c.first_name) LIKE ${`%${search.toLowerCase()}%`}
                   OR LOWER(c.last_name) LIKE ${`%${search.toLowerCase()}%`})
            ))`,
          )
        }

        const rows = await db
          .select({
            id: reservations.id,
            number: reservations.number,
            status: reservations.status,
            startDate: reservations.startDate,
            endDate: reservations.endDate,
            totalAmount: reservations.totalAmount,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
          })
          .from(reservations)
          .leftJoin(customers, eq(reservations.customerId, customers.id))
          .where(and(...conditions))
          .orderBy(desc(reservations.createdAt))
          .limit(50)

        const [countResult] = await db
          .select({ total: sql<number>`COUNT(*)` })
          .from(reservations)
          .where(and(...conditions))

        return { reservations: rows, total: countResult?.total ?? 0 }
      },
    }),

    get_reservation: tool({
      description: 'Get complete details of a specific reservation',
      inputSchema: z.object({
        reservationId: z.string().describe('The reservation ID'),
      }),
      execute: async ({ reservationId }) => {
        requirePermission(ctx, 'reservations', 'read')

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          with: {
            customer: true,
            items: { with: { product: { columns: { id: true, name: true } } } },
            payments: true,
          },
        })

        if (!reservation) return { error: 'Reservation not found' }
        return { reservation }
      },
    }),

    update_reservation_status: tool({
      description: 'Change the status of a reservation (confirm, reject, cancel, etc.)',
      inputSchema: z.object({
        reservationId: z.string().describe('The reservation ID'),
        status: z.enum(['confirmed', 'ongoing', 'completed', 'cancelled', 'rejected']).describe('New status'),
      }),
      execute: async ({ reservationId, status: newStatus }) => {
        requirePermission(ctx, 'reservations', 'write')

        const existing = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true, status: true },
        })
        if (!existing) return { error: 'Reservation not found' }

        const validTransitions: Record<string, string[]> = {
          pending: ['confirmed', 'rejected', 'cancelled'],
          confirmed: ['ongoing', 'cancelled'],
          ongoing: ['completed'],
        }
        const allowed = validTransitions[existing.status]
        if (!allowed?.includes(newStatus)) {
          return { error: `Invalid transition: ${existing.status} → ${newStatus}. Allowed: ${allowed?.join(', ') ?? 'none'}` }
        }

        const updateData: Record<string, unknown> = { status: newStatus }
        if (newStatus === 'ongoing') updateData.pickedUpAt = new Date()
        if (newStatus === 'completed') updateData.returnedAt = new Date()

        await db.update(reservations).set(updateData).where(eq(reservations.id, reservationId))
        return { success: true, number: existing.number, from: existing.status, to: newStatus }
      },
    }),

    update_reservation_notes: tool({
      description: 'Update internal notes on a reservation',
      inputSchema: z.object({
        reservationId: z.string().describe('The reservation ID'),
        notes: z.string().describe('The new internal notes content'),
      }),
      execute: async ({ reservationId, notes }) => {
        requirePermission(ctx, 'reservations', 'write')

        const existing = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true },
        })
        if (!existing) return { error: 'Reservation not found' }

        await db.update(reservations).set({ internalNotes: notes }).where(eq(reservations.id, reservationId))
        return { success: true, number: existing.number }
      },
    }),

    get_reservation_counters: tool({
      description: 'Get quick reservation counters by status (pending, ongoing, etc.)',
      inputSchema: z.object({}),
      execute: async () => {
        requirePermission(ctx, 'reservations', 'read')

        const rows = await db
          .select({ status: reservations.status, count: sql<number>`COUNT(*)` })
          .from(reservations)
          .where(eq(reservations.storeId, ctx.storeId))
          .groupBy(reservations.status)

        const counts: Record<string, number> = {}
        for (const row of rows) counts[row.status] = row.count

        return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
      },
    }),

    // ── Customers ─────────────────────────────────────────────────────────

    list_customers: tool({
      description: 'List customers with optional search, type filter, and date filter',
      inputSchema: z.object({
        search: z.string().optional().describe('Search by name or email'),
        type: z.enum(['individual', 'business']).optional(),
        since: z.string().optional().describe('Only customers created after this date (YYYY-MM-DD)'),
      }),
      execute: async ({ search, type, since }) => {
        requirePermission(ctx, 'customers', 'read')

        const conditions = [eq(customers.storeId, ctx.storeId)]
        if (type) conditions.push(eq(customers.customerType, type))
        if (since) conditions.push(gte(customers.createdAt, new Date(since)))
        if (search) {
          const s = `%${search.toLowerCase()}%`
          conditions.push(
            sql`(LOWER(${customers.firstName}) LIKE ${s} OR LOWER(${customers.lastName}) LIKE ${s} OR LOWER(${customers.email}) LIKE ${s})`,
          )
        }

        const rows = await db
          .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            customerType: customers.customerType,
            companyName: customers.companyName,
            createdAt: customers.createdAt,
          })
          .from(customers)
          .where(and(...conditions))
          .orderBy(desc(customers.createdAt))
          .limit(50)

        const [countResult] = await db
          .select({ total: sql<number>`COUNT(*)` })
          .from(customers)
          .where(and(...conditions))

        return { customers: rows, total: countResult?.total ?? 0 }
      },
    }),

    get_customer: tool({
      description: 'Get detailed customer profile with reservation history',
      inputSchema: z.object({
        customerId: z.string().describe('The customer ID'),
      }),
      execute: async ({ customerId }) => {
        requirePermission(ctx, 'customers', 'read')

        const customer = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
          with: {
            reservations: { orderBy: [desc(reservations.createdAt)], limit: 10 },
          },
        })

        if (!customer) return { error: 'Customer not found' }
        return { customer }
      },
    }),

    create_customer: tool({
      description: 'Create a new customer',
      inputSchema: z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional(),
        customerType: z.enum(['individual', 'business']).optional(),
        companyName: z.string().optional(),
      }),
      execute: async ({ email, firstName, lastName, phone, customerType, companyName }) => {
        requirePermission(ctx, 'customers', 'write')

        const existing = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.email, email)),
          columns: { id: true },
        })
        if (existing) return { error: 'A customer with this email already exists' }

        const [created] = await db
          .insert(customers)
          .values({
            storeId: ctx.storeId,
            email,
            firstName,
            lastName,
            phone: phone ?? null,
            customerType: customerType ?? 'individual',
            companyName: companyName ?? null,
          })
          .$returningId()

        return { id: created.id, firstName, lastName, email }
      },
    }),

    update_customer: tool({
      description: 'Update an existing customer',
      inputSchema: z.object({
        customerId: z.string().describe('The customer ID'),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        postalCode: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async ({ customerId, ...updates }) => {
        requirePermission(ctx, 'customers', 'write')

        const existing = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
          columns: { id: true, email: true },
        })
        if (!existing) return { error: 'Customer not found' }

        if (updates.email && updates.email !== existing.email) {
          const emailTaken = await db.query.customers.findFirst({
            where: and(eq(customers.storeId, ctx.storeId), eq(customers.email, updates.email)),
            columns: { id: true },
          })
          if (emailTaken) return { error: 'A customer with this email already exists' }
        }

        const updateData: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateData[key] = value
        }

        if (Object.keys(updateData).length === 0) {
          return { error: 'No fields to update' }
        }

        await db.update(customers).set(updateData).where(eq(customers.id, customerId))
        return { success: true, customerId }
      },
    }),

    // ── Payments ──────────────────────────────────────────────────────────

    list_payments: tool({
      description: 'List all payments for a specific reservation',
      inputSchema: z.object({
        reservationId: z.string().describe('The reservation ID'),
      }),
      execute: async ({ reservationId }) => {
        requirePermission(ctx, 'payments', 'read')

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true },
        })
        if (!reservation) return { error: 'Reservation not found' }

        const rows = await db.query.payments.findMany({
          where: eq(payments.reservationId, reservationId),
          orderBy: [payments.createdAt],
        })

        return { payments: rows, reservationNumber: reservation.number }
      },
    }),

    record_payment: tool({
      description: 'Record a manual payment for a reservation',
      inputSchema: z.object({
        reservationId: z.string(),
        type: z.enum(['rental', 'deposit', 'deposit_return', 'damage', 'adjustment']),
        amount: z.string().describe('Amount (e.g. "150.00")'),
        method: z.enum(['cash', 'card', 'transfer', 'check', 'other']),
        notes: z.string().optional(),
      }),
      execute: async ({ reservationId, type, amount, method, notes }) => {
        requirePermission(ctx, 'payments', 'write')

        const numAmount = parseFloat(amount)
        if (isNaN(numAmount) || numAmount === 0) {
          return { error: 'Amount must be a non-zero number' }
        }

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true, status: true },
        })
        if (!reservation) return { error: 'Reservation not found' }

        if (reservation.status === 'cancelled' || reservation.status === 'rejected') {
          return { error: `Cannot record payment on a ${reservation.status} reservation` }
        }

        await db.insert(payments).values({
          reservationId,
          type,
          amount,
          method,
          status: 'completed',
          paidAt: new Date(),
          notes: notes ?? null,
        })

        return { success: true, reservationNumber: reservation.number, type, amount, method }
      },
    }),

    delete_payment: tool({
      description: 'Delete a manual payment record (cannot delete Stripe payments)',
      inputSchema: z.object({
        paymentId: z.string().describe('The payment ID to delete'),
      }),
      execute: async ({ paymentId }) => {
        requirePermission(ctx, 'payments', 'write')

        const payment = await db.query.payments.findFirst({
          where: eq(payments.id, paymentId),
          with: { reservation: { columns: { storeId: true, number: true } } },
        })

        if (!payment || payment.reservation?.storeId !== ctx.storeId) {
          return { error: 'Payment not found' }
        }

        if (payment.method === 'stripe') {
          return { error: 'Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.' }
        }

        await db.delete(payments).where(eq(payments.id, paymentId))
        return { success: true, reservationNumber: payment.reservation?.number }
      },
    }),

    return_deposit: tool({
      description: 'Record a deposit return for a reservation (validates max returnable amount)',
      inputSchema: z.object({
        reservationId: z.string().describe('The reservation ID'),
        amount: z.string().describe('Amount to return (e.g. "100.00")'),
        method: z.enum(['cash', 'card', 'transfer', 'check', 'other']).describe('Return method'),
        notes: z.string().optional(),
      }),
      execute: async ({ reservationId, amount, method, notes }) => {
        requirePermission(ctx, 'payments', 'write')

        const numAmount = parseFloat(amount)
        if (isNaN(numAmount) || numAmount <= 0) {
          return { error: 'Amount must be greater than zero' }
        }

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true },
          with: { payments: true },
        })
        if (!reservation) return { error: 'Reservation not found' }

        const depositCollected = reservation.payments
          .filter((p) => p.type === 'deposit' && p.status === 'completed')
          .reduce((s, p) => s + parseFloat(p.amount), 0)
        const depositReturned = reservation.payments
          .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
          .reduce((s, p) => s + parseFloat(p.amount), 0)
        const maxReturnable = depositCollected - depositReturned

        if (numAmount > maxReturnable) {
          return {
            error: `Amount exceeds returnable deposit. Collected: ${depositCollected.toFixed(2)}, already returned: ${depositReturned.toFixed(2)}, max returnable: ${maxReturnable.toFixed(2)}`,
          }
        }

        await db.insert(payments).values({
          reservationId,
          type: 'deposit_return',
          amount,
          method,
          status: 'completed',
          paidAt: new Date(),
          notes: notes ?? null,
        })

        return { success: true, reservationNumber: reservation.number, amount, method }
      },
    }),

    // ── Analytics ─────────────────────────────────────────────────────────

    get_dashboard_stats: tool({
      description: 'Get key dashboard metrics (revenue, reservations, visitors) for a given period',
      inputSchema: z.object({
        period: z.enum(['7d', '30d', '90d', '12m']).optional().describe('Time period (default 30d)'),
      }),
      execute: async ({ period }) => {
        requirePermission(ctx, 'analytics', 'read')

        const end = new Date()
        const start = new Date()
        switch (period ?? '30d') {
          case '7d': start.setDate(start.getDate() - 7); break
          case '30d': start.setDate(start.getDate() - 30); break
          case '90d': start.setDate(start.getDate() - 90); break
          case '12m': start.setMonth(start.getMonth() - 12); break
        }

        const stats = await db
          .select({
            totalRevenue: sum(dailyStats.revenue),
            totalReservationsCreated: sum(dailyStats.reservationsCreated),
            totalReservationsConfirmed: sum(dailyStats.reservationsConfirmed),
            totalVisitors: sum(dailyStats.uniqueVisitors),
            totalPageViews: sum(dailyStats.pageViews),
          })
          .from(dailyStats)
          .where(and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, start),
            lte(dailyStats.date, end),
          ))

        const [activeCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(reservations)
          .where(and(
            eq(reservations.storeId, ctx.storeId),
            sql`${reservations.status} IN ('pending', 'confirmed', 'ongoing')`,
          ))

        return {
          period: period ?? '30d',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...stats[0],
          activeReservations: activeCount?.count ?? 0,
        }
      },
    }),

    get_product_performance: tool({
      description: 'Get top-performing products by revenue',
      inputSchema: z.object({
        period: z.enum(['7d', '30d', '90d', '12m']).optional(),
        limit: z.number().optional().describe('Number of products (default 10)'),
      }),
      execute: async ({ period, limit: maxResults }) => {
        requirePermission(ctx, 'analytics', 'read')

        const end = new Date()
        const start = new Date()
        switch (period ?? '30d') {
          case '7d': start.setDate(start.getDate() - 7); break
          case '30d': start.setDate(start.getDate() - 30); break
          case '90d': start.setDate(start.getDate() - 90); break
          case '12m': start.setMonth(start.getMonth() - 12); break
        }
        const lim = Math.min(maxResults ?? 10, 50)

        const rows = await db
          .select({
            productId: productStats.productId,
            productName: products.name,
            totalViews: sum(productStats.views),
            totalReservations: sum(productStats.reservations),
            totalRevenue: sum(productStats.revenue),
          })
          .from(productStats)
          .innerJoin(products, eq(productStats.productId, products.id))
          .where(and(
            eq(productStats.storeId, ctx.storeId),
            gte(productStats.date, start),
            lte(productStats.date, end),
          ))
          .groupBy(productStats.productId, products.name)
          .orderBy(desc(sum(productStats.revenue)))
          .limit(lim)

        return { products: rows, period: period ?? '30d' }
      },
    }),

    get_revenue_report: tool({
      description: 'Get a day-by-day revenue breakdown over a custom date range',
      inputSchema: z.object({
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async ({ startDate, endDate }) => {
        requirePermission(ctx, 'analytics', 'read')

        const start = new Date(startDate)
        const end = new Date(endDate)

        const rows = await db
          .select({
            date: dailyStats.date,
            revenue: dailyStats.revenue,
            reservationsCreated: dailyStats.reservationsCreated,
            reservationsConfirmed: dailyStats.reservationsConfirmed,
            uniqueVisitors: dailyStats.uniqueVisitors,
          })
          .from(dailyStats)
          .where(and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, start),
            lte(dailyStats.date, end),
          ))
          .orderBy(dailyStats.date)

        const totalRevenue = rows.reduce((acc, r) => acc + parseFloat(r.revenue ?? '0'), 0)
        const totalReservations = rows.reduce((acc, r) => acc + (r.reservationsCreated ?? 0), 0)

        return {
          startDate,
          endDate,
          totalRevenue: totalRevenue.toFixed(2),
          totalReservations,
          daysWithData: rows.length,
          daily: rows,
        }
      },
    }),

    // ── Calendar ──────────────────────────────────────────────────────────

    calendar_upcoming: tool({
      description: 'Get upcoming pickups and returns for the next N days',
      inputSchema: z.object({
        days: z.number().optional().describe('Number of days to look ahead (default 7)'),
      }),
      execute: async ({ days }) => {
        requirePermission(ctx, 'reservations', 'read')

        const lookAhead = Math.min(days ?? 7, 90)
        const now = new Date()
        const future = new Date()
        future.setDate(future.getDate() + lookAhead)

        const pickups = await db
          .select({
            id: reservations.id,
            number: reservations.number,
            startDate: reservations.startDate,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            totalAmount: reservations.totalAmount,
          })
          .from(reservations)
          .leftJoin(customers, eq(reservations.customerId, customers.id))
          .where(and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'confirmed'),
            gte(reservations.startDate, now),
            lte(reservations.startDate, future),
          ))
          .orderBy(reservations.startDate)
          .limit(50)

        const returns = await db
          .select({
            id: reservations.id,
            number: reservations.number,
            endDate: reservations.endDate,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            totalAmount: reservations.totalAmount,
          })
          .from(reservations)
          .leftJoin(customers, eq(reservations.customerId, customers.id))
          .where(and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, now),
            lte(reservations.endDate, future),
          ))
          .orderBy(reservations.endDate)
          .limit(50)

        return { pickups, returns, days: lookAhead }
      },
    }),

    calendar_overdue: tool({
      description: 'Get overdue returns (ongoing reservations past their end date)',
      inputSchema: z.object({}),
      execute: async () => {
        requirePermission(ctx, 'reservations', 'read')

        const now = new Date()
        const overdue = await db
          .select({
            id: reservations.id,
            number: reservations.number,
            endDate: reservations.endDate,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            totalAmount: reservations.totalAmount,
          })
          .from(reservations)
          .leftJoin(customers, eq(reservations.customerId, customers.id))
          .where(and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            lte(reservations.endDate, now),
          ))
          .orderBy(reservations.endDate)
          .limit(50)

        return { overdue }
      },
    }),

    check_availability: tool({
      description: 'Check product availability for a date range',
      inputSchema: z.object({
        productId: z.string(),
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async ({ productId, startDate, endDate }) => {
        requirePermission(ctx, 'products', 'read')

        const start = new Date(startDate)
        const end = new Date(endDate)

        const product = await db.query.products.findFirst({
          where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
          columns: { id: true, name: true, quantity: true },
        })
        if (!product) return { error: 'Product not found' }

        const [overlap] = await db
          .select({ count: sql<number>`COALESCE(SUM(${reservationItems.quantity}), 0)` })
          .from(reservationItems)
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .where(and(
            eq(reservationItems.productId, productId),
            eq(reservations.storeId, ctx.storeId),
            sql`${reservations.status} IN ('pending', 'confirmed', 'ongoing')`,
            lte(reservations.startDate, end),
            gte(reservations.endDate, start),
          ))

        const reserved = overlap?.count ?? 0
        const available = Math.max(0, product.quantity - reserved)

        return { product: product.name, totalStock: product.quantity, reserved, available, startDate, endDate }
      },
    }),

    // ── Categories ────────────────────────────────────────────────────────

    list_categories: tool({
      description: 'List all product categories',
      inputSchema: z.object({}),
      execute: async () => {
        requirePermission(ctx, 'categories', 'read')

        const rows = await db.query.categories.findMany({
          where: eq(categories.storeId, ctx.storeId),
          with: { products: { columns: { id: true } } },
          orderBy: [categories.order, categories.name],
        })

        return {
          categories: rows.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            productCount: c.products.length,
          })),
        }
      },
    }),

    create_category: tool({
      description: 'Create a new product category',
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }),
      execute: async ({ name, description }) => {
        requirePermission(ctx, 'categories', 'write')

        const [created] = await db
          .insert(categories)
          .values({ storeId: ctx.storeId, name, description: description ?? null })
          .$returningId()

        return { id: created.id, name }
      },
    }),

    update_category: tool({
      description: 'Update an existing product category',
      inputSchema: z.object({
        categoryId: z.string().describe('The category ID'),
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description'),
      }),
      execute: async ({ categoryId, name, description }) => {
        requirePermission(ctx, 'categories', 'write')

        const existing = await db.query.categories.findFirst({
          where: and(eq(categories.storeId, ctx.storeId), eq(categories.id, categoryId)),
          columns: { id: true },
        })
        if (!existing) return { error: 'Category not found' }

        const updateData: Record<string, unknown> = {}
        if (name !== undefined) updateData.name = name
        if (description !== undefined) updateData.description = description

        if (Object.keys(updateData).length === 0) {
          return { error: 'No fields to update' }
        }

        await db.update(categories).set(updateData).where(eq(categories.id, categoryId))
        return { success: true, categoryId }
      },
    }),

    delete_category: tool({
      description: 'Delete a product category (products will be unassigned)',
      inputSchema: z.object({
        categoryId: z.string().describe('The category ID to delete'),
      }),
      execute: async ({ categoryId }) => {
        requirePermission(ctx, 'categories', 'write')

        const existing = await db.query.categories.findFirst({
          where: and(eq(categories.storeId, ctx.storeId), eq(categories.id, categoryId)),
          columns: { id: true, name: true },
        })
        if (!existing) return { error: 'Category not found' }

        await db.delete(categories).where(eq(categories.id, categoryId))
        return { success: true, name: existing.name }
      },
    }),

    // ── Settings ──────────────────────────────────────────────────────────

    get_store_settings: tool({
      description: 'Get complete store configuration (name, contact, settings)',
      inputSchema: z.object({}),
      execute: async () => {
        requirePermission(ctx, 'settings', 'read')

        const store = await db.query.stores.findFirst({
          where: eq(stores.id, ctx.storeId),
        })

        if (!store) return { error: 'Store not found' }
        return {
          name: store.name,
          slug: store.slug,
          email: store.email,
          phone: store.phone,
          address: store.address,
          description: store.description,
          settings: store.settings,
          theme: store.theme,
          emailSettings: store.emailSettings,
          stripeConnected: !!store.stripeOnboardingComplete,
        }
      },
    }),

    update_store_info: tool({
      description: 'Update store contact information',
      inputSchema: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async (updates) => {
        requirePermission(ctx, 'settings', 'write')

        const updateData: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateData[key] = value
        }

        if (Object.keys(updateData).length === 0) {
          return { error: 'No fields to update' }
        }

        await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId))
        return { success: true }
      },
    }),
  }
}
