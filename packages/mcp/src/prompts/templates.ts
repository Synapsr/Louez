import { z } from 'zod'
import { db, reservations, customers, dailyStats } from '@louez/db'
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate, formatStatus } from '../utils/formatting'

export function registerPromptTemplates(server: McpServer, ctx: McpSessionContext) {
  server.prompt(
    'daily-briefing',
    'Generate a structured daily briefing with key metrics and upcoming actions',
    {},
    async () => {
      requirePermission(ctx, 'analytics', 'read')

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      // Today's stats
      const [todayStats] = await db
        .select({
          revenue: sum(dailyStats.revenue),
          visitors: sum(dailyStats.uniqueVisitors),
          reservationsCreated: sum(dailyStats.reservationsCreated),
        })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, today),
            lte(dailyStats.date, tomorrow)
          )
        )

      // Pending reservations
      const [pendingCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reservations)
        .where(and(eq(reservations.storeId, ctx.storeId), eq(reservations.status, 'pending')))

      // Today's pickups
      const todaysPickups = await db
        .select({
          number: reservations.number,
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          totalAmount: reservations.totalAmount,
        })
        .from(reservations)
        .leftJoin(customers, eq(reservations.customerId, customers.id))
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'confirmed'),
            gte(reservations.startDate, today),
            lte(reservations.startDate, tomorrow)
          )
        )

      // Today's returns
      const todaysReturns = await db
        .select({
          number: reservations.number,
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          totalAmount: reservations.totalAmount,
        })
        .from(reservations)
        .leftJoin(customers, eq(reservations.customerId, customers.id))
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, today),
            lte(reservations.endDate, tomorrow)
          )
        )

      // Overdue
      const [overdueCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            lte(reservations.endDate, today)
          )
        )

      const briefingData =
        `Date: ${formatDate(today)}\n` +
        `Store: ${ctx.storeName}\n\n` +
        `Today's metrics:\n` +
        `  Revenue: ${formatCurrency(todayStats?.revenue ?? '0')}\n` +
        `  Visitors: ${todayStats?.visitors ?? 0}\n` +
        `  New reservations: ${todayStats?.reservationsCreated ?? 0}\n\n` +
        `Pending actions: ${pendingCount?.count ?? 0} reservations to review\n` +
        `Overdue returns: ${overdueCount?.count ?? 0}\n\n` +
        `Today's pickups (${todaysPickups.length}):\n` +
        (todaysPickups.length > 0
          ? todaysPickups.map((p) => `  - #${p.number} — ${p.customerFirstName} ${p.customerLastName} — ${formatCurrency(p.totalAmount)}`).join('\n')
          : '  None') +
        `\n\nToday's returns (${todaysReturns.length}):\n` +
        (todaysReturns.length > 0
          ? todaysReturns.map((r) => `  - #${r.number} — ${r.customerFirstName} ${r.customerLastName} — ${formatCurrency(r.totalAmount)}`).join('\n')
          : '  None')

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Here is today's business data for the rental store "${ctx.storeName}":\n\n` +
                briefingData +
                `\n\nPlease generate a concise daily briefing summarizing the key metrics, ` +
                `highlighting any urgent actions (pending reservations, overdue returns), ` +
                `and providing a clear overview of today's schedule.`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    'reservation-summary',
    'Generate a comprehensive summary of a specific reservation',
    { reservationId: z.string().describe('The reservation ID to summarize') },
    async ({ reservationId }) => {
      requirePermission(ctx, 'reservations', 'read')

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        with: {
          customer: true,
          items: { with: { product: { columns: { id: true, name: true } } } },
          payments: true,
        },
      })

      if (!reservation) {
        return {
          messages: [
            {
              role: 'user' as const,
              content: { type: 'text' as const, text: `Reservation ${reservationId} not found.` },
            },
          ],
        }
      }

      const c = reservation.customer
      const items = reservation.items
        .map((i) => `  - ${i.product?.name ?? 'Custom item'} × ${i.quantity} — ${formatCurrency(i.totalPrice)}`)
        .join('\n')
      const paymentLines = reservation.payments
        .map((p) => `  - ${p.type}: ${formatCurrency(p.amount)} (${p.method}, ${p.status})`)
        .join('\n')

      const data =
        `Reservation #${reservation.number}\n` +
        `Status: ${formatStatus(reservation.status)}\n` +
        `Period: ${formatDate(reservation.startDate)} → ${formatDate(reservation.endDate)}\n` +
        `Source: ${reservation.source}\n\n` +
        `Customer: ${c?.firstName} ${c?.lastName} (${c?.email})\n` +
        (c?.phone ? `Phone: ${c.phone}\n` : '') +
        `\nItems:\n${items}\n` +
        `\nAmounts:\n` +
        `  Subtotal: ${formatCurrency(reservation.subtotalAmount)}\n` +
        `  Deposit: ${formatCurrency(reservation.depositAmount)}\n` +
        `  Total: ${formatCurrency(reservation.totalAmount)}\n` +
        (paymentLines ? `\nPayments:\n${paymentLines}\n` : '') +
        (reservation.internalNotes ? `\nInternal notes: ${reservation.internalNotes}\n` : '') +
        (reservation.customerNotes ? `\nCustomer notes: ${reservation.customerNotes}\n` : '')

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Here is the complete data for reservation #${reservation.number}:\n\n` +
                data +
                `\n\nPlease provide a comprehensive summary, highlight any important details ` +
                `or potential issues, and suggest next steps based on the current status.`,
            },
          },
        ],
      }
    }
  )
}
