import { db, reservations, stores } from '@louez/db'
import { revenueReport } from '@louez/api/services/analytics'
import { and, eq, lte, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'

import type { McpRequestContext } from '../auth/context'
import { hasPermission } from '../auth/context'
import { formatCurrency } from '../utils/formatting'

/** What the store's figures need: its time zone and its currency. */
export async function analyticsStore(storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { id: true, settings: true },
  })
  return store ?? { id: storeId, settings: null }
}

export function registerDashboardResources(server: McpServer, ctx: McpRequestContext) {
  server.registerResource(
    'dashboard-summary',
    'louez://dashboard/summary',
    { description: 'Business summary: the last 30 days of revenue and reservations, and the reservations by status', mimeType: 'text/plain' },
    async () => {
      if (!hasPermission(ctx, 'analytics', 'read')) {
        return { contents: [{ uri: 'louez://dashboard/summary', text: 'Permission denied: requires analytics:read' }] }
      }
      const now = new Date()

      // The last 30 days, as the dashboard's sales page counts them.
      const report = await revenueReport(await analyticsStore(ctx.storeId), { period: '30d' }, now)

      // Reservation counts by status
      const statusCounts = await db
        .select({
          status: reservations.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(reservations)
        .where(eq(reservations.storeId, ctx.storeId))
        .groupBy(reservations.status)

      const counts: Record<string, number> = {}
      for (const row of statusCounts) {
        counts[row.status] = row.count
      }

      // Overdue returns
      const [overdueCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            lte(reservations.endDate, now)
          )
        )

      const text =
        `Business Summary — ${ctx.storeName}\n\n` +
        `Last 30 days (from ${report.window.start.toISOString()}, ${report.window.timezone}, up to now):\n` +
        `  Revenue (rental payments received): ${report.revenue} ${report.currency}\n` +
        `  Reservations starting: ${report.reservations}\n\n` +
        `Current reservations:\n` +
        `  Pending: ${counts.pending ?? 0}\n` +
        `  Confirmed: ${counts.confirmed ?? 0}\n` +
        `  Ongoing: ${counts.ongoing ?? 0}\n` +
        `  Completed: ${counts.completed ?? 0}\n` +
        `  Overdue returns: ${overdueCount?.count ?? 0}`

      return { contents: [{ uri: 'louez://dashboard/summary', text }] }
    }
  )

  server.registerResource(
    'pending-reservations',
    'louez://dashboard/reservations/pending',
    { description: 'Reservations pending action (to confirm or reject)', mimeType: 'text/plain' },
    async () => {
      if (!hasPermission(ctx, 'reservations', 'read')) {
        return { contents: [{ uri: 'louez://dashboard/reservations/pending', text: 'Permission denied: requires reservations:read' }] }
      }
      const rows = await db.query.reservations.findMany({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.status, 'pending')
        ),
        with: { customer: { columns: { firstName: true, lastName: true, email: true } } },
        orderBy: [reservations.createdAt],
        limit: 50,
      })

      if (rows.length === 0) {
        return { contents: [{ uri: 'louez://dashboard/reservations/pending', text: 'No pending reservations.' }] }
      }

      const lines = rows.map(
        (r) =>
          `#${r.number} — ${r.customer?.firstName} ${r.customer?.lastName} (${r.customer?.email})\n` +
          `  ${r.startDate.toISOString().slice(0, 10)} → ${r.endDate.toISOString().slice(0, 10)} — ${formatCurrency(r.totalAmount)}`
      )

      return {
        contents: [{
          uri: 'louez://dashboard/reservations/pending',
          text: `Pending reservations (${rows.length}):\n\n${lines.join('\n\n')}`,
        }],
      }
    }
  )
}
