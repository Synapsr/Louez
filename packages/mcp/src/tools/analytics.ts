import { z } from 'zod'
import { db, dailyStats, productStats, products, reservations } from '@louez/db'
import { and, eq, gte, lte, desc, sql, sum } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate } from '../utils/formatting'
import { toolResult } from '../utils/errors'

function periodToRange(period: string): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date()
  switch (period) {
    case '7d':
      start.setDate(start.getDate() - 7)
      break
    case '30d':
      start.setDate(start.getDate() - 30)
      break
    case '90d':
      start.setDate(start.getDate() - 90)
      break
    case '12m':
      start.setMonth(start.getMonth() - 12)
      break
    default:
      start.setDate(start.getDate() - 30)
  }
  return { start, end }
}

export function registerAnalyticsTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'get_dashboard_stats',
    'Get key dashboard metrics (revenue, reservations, visitors) for a given period',
    {
      period: z.enum(['7d', '30d', '90d', '12m']).optional().describe('Time period (default 30d)'),
    },
    async ({ period }) => {
      requirePermission(ctx, 'analytics', 'read')
      const { start, end } = periodToRange(period ?? '30d')

      const stats = await db
        .select({
          totalPageViews: sum(dailyStats.pageViews),
          totalVisitors: sum(dailyStats.uniqueVisitors),
          totalRevenue: sum(dailyStats.revenue),
          totalReservationsCreated: sum(dailyStats.reservationsCreated),
          totalReservationsConfirmed: sum(dailyStats.reservationsConfirmed),
          totalCheckoutCompleted: sum(dailyStats.checkoutCompleted),
        })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, start),
            lte(dailyStats.date, end)
          )
        )

      const s = stats[0]

      const [activeCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            sql`${reservations.status} IN ('pending', 'confirmed', 'ongoing')`
          )
        )

      return toolResult(
        `## Dashboard — ${period ?? '30d'}\n` +
          `*${formatDate(start)} → ${formatDate(end)}*\n\n` +
          `- **Revenue**: ${formatCurrency(s?.totalRevenue ?? '0')}\n` +
          `- **Reservations created**: ${s?.totalReservationsCreated ?? 0}\n` +
          `- **Reservations confirmed**: ${s?.totalReservationsConfirmed ?? 0}\n` +
          `- **Checkouts completed**: ${s?.totalCheckoutCompleted ?? 0}\n` +
          `- **Unique visitors**: ${s?.totalVisitors ?? 0}\n` +
          `- **Page views**: ${s?.totalPageViews ?? 0}\n\n` +
          `### Active reservations\n` +
          `- Pending + confirmed + ongoing: ${activeCount?.count ?? 0}`
      )
    }
  )

  server.tool(
    'get_revenue_report',
    'Get a revenue breakdown over a date range',
    {
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async ({ startDate, endDate }) => {
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
        .where(
          and(
            eq(dailyStats.storeId, ctx.storeId),
            gte(dailyStats.date, start),
            lte(dailyStats.date, end)
          )
        )
        .orderBy(dailyStats.date)

      const totalRevenue = rows.reduce((acc, r) => acc + parseFloat(r.revenue ?? '0'), 0)
      const totalReservations = rows.reduce((acc, r) => acc + (r.reservationsCreated ?? 0), 0)

      let text =
        `## Revenue report\n` +
        `*${formatDate(start)} → ${formatDate(end)}*\n\n` +
        `- **Total revenue**: ${formatCurrency(totalRevenue)}\n` +
        `- **Reservations**: ${totalReservations}\n` +
        `- **Days with data**: ${rows.length}\n`

      if (rows.length > 0) {
        text += `\n### Daily breakdown\n`
        for (const row of rows) {
          const rev = parseFloat(row.revenue ?? '0')
          if (rev > 0 || (row.reservationsCreated ?? 0) > 0) {
            text += `- ${formatDate(row.date)}: ${formatCurrency(rev)} (${row.reservationsCreated} res., ${row.uniqueVisitors} visitors)\n`
          }
        }
      }

      return toolResult(text)
    }
  )

  server.tool(
    'get_product_performance',
    'Get top-performing products by views, reservations, and revenue',
    {
      period: z.enum(['7d', '30d', '90d', '12m']).optional().describe('Time period (default 30d)'),
      limit: z.number().optional().describe('Number of products to show (default 10)'),
    },
    async ({ period, limit: maxResults }) => {
      requirePermission(ctx, 'analytics', 'read')
      const { start, end } = periodToRange(period ?? '30d')
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
        .where(
          and(
            eq(productStats.storeId, ctx.storeId),
            gte(productStats.date, start),
            lte(productStats.date, end)
          )
        )
        .groupBy(productStats.productId, products.name)
        .orderBy(desc(sum(productStats.revenue)))
        .limit(lim)

      if (rows.length === 0) {
        return toolResult('No product performance data for this period.')
      }

      const lines = rows.map(
        (r, i) =>
          `${i + 1}. **${r.productName}**\n` +
          `   Views: ${r.totalViews ?? 0} | Reservations: ${r.totalReservations ?? 0} | Revenue: ${formatCurrency(r.totalRevenue ?? '0')}`
      )

      return toolResult(
        `## Top products — ${period ?? '30d'}\n\n${lines.join('\n')}`
      )
    }
  )
}
