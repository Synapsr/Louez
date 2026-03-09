import { db, reservations, dailyStats } from '@louez/db'
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { hasPermission } from '../auth/context'
import { formatCurrency } from '../utils/formatting'

export function registerDashboardResources(server: McpServer, ctx: McpSessionContext) {
  server.resource(
    'dashboard-summary',
    'louez://dashboard/summary',
    { description: 'Daily business summary (reservations, revenue, key metrics)', mimeType: 'text/plain' },
    async () => {
      if (!hasPermission(ctx, 'analytics', 'read')) {
        return { contents: [{ uri: 'louez://dashboard/summary', text: 'Permission denied: requires analytics:read' }] }
      }
      const now = new Date()
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Last 30 days stats
      const [stats] = await db
        .select({
          totalRevenue: sum(dailyStats.revenue),
          totalVisitors: sum(dailyStats.uniqueVisitors),
          totalReservations: sum(dailyStats.reservationsCreated),
        })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, thirtyDaysAgo),
            lte(dailyStats.date, now)
          )
        )

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
        `Last 30 days:\n` +
        `  Revenue: ${formatCurrency(stats?.totalRevenue ?? '0')}\n` +
        `  Reservations created: ${stats?.totalReservations ?? 0}\n` +
        `  Unique visitors: ${stats?.totalVisitors ?? 0}\n\n` +
        `Current reservations:\n` +
        `  Pending: ${counts.pending ?? 0}\n` +
        `  Confirmed: ${counts.confirmed ?? 0}\n` +
        `  Ongoing: ${counts.ongoing ?? 0}\n` +
        `  Completed: ${counts.completed ?? 0}\n` +
        `  Overdue returns: ${overdueCount?.count ?? 0}`

      return { contents: [{ uri: 'louez://dashboard/summary', text }] }
    }
  )

  server.resource(
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
