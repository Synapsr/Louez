import { z } from 'zod'
import { db, reservations, customers, products, reservationItems } from '@louez/db'
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate, formatDateTime } from '../utils/formatting'
import { toolResult } from '../utils/errors'

export function registerCalendarTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'calendar_upcoming',
    'Get upcoming pickups and returns for the next N days',
    {
      days: z.number().optional().describe('Number of days to look ahead (default 7)'),
    },
    async ({ days }) => {
      requirePermission(ctx, 'reservations', 'read')

      const lookAhead = Math.min(days ?? 7, 90)
      const now = new Date()
      const future = new Date()
      future.setDate(future.getDate() + lookAhead)

      // Upcoming pickups (startDate in range, status confirmed)
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
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'confirmed'),
            gte(reservations.startDate, now),
            lte(reservations.startDate, future)
          )
        )
        .orderBy(reservations.startDate)
        .limit(50)

      // Upcoming returns (endDate in range, status ongoing)
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
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, now),
            lte(reservations.endDate, future)
          )
        )
        .orderBy(reservations.endDate)
        .limit(50)

      let text = `## Calendrier — ${lookAhead} prochains jours\n\n`

      text += `### Départs à venir (${pickups.length})\n`
      if (pickups.length === 0) {
        text += 'Aucun départ prévu.\n'
      } else {
        for (const p of pickups) {
          text += `- ${formatDateTime(p.startDate)} — #${p.number} — ${p.customerFirstName} ${p.customerLastName} — ${formatCurrency(p.totalAmount)}\n`
        }
      }

      text += `\n### Retours à venir (${returns.length})\n`
      if (returns.length === 0) {
        text += 'Aucun retour prévu.\n'
      } else {
        for (const r of returns) {
          text += `- ${formatDateTime(r.endDate)} — #${r.number} — ${r.customerFirstName} ${r.customerLastName} — ${formatCurrency(r.totalAmount)}\n`
        }
      }

      return toolResult(text)
    }
  )

  server.tool(
    'calendar_overdue',
    'Get overdue returns (ongoing reservations past their end date)',
    {},
    async () => {
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
        .where(
          and(
            eq(reservations.storeId, ctx.storeId),
            eq(reservations.status, 'ongoing'),
            lte(reservations.endDate, now)
          )
        )
        .orderBy(reservations.endDate)
        .limit(50)

      if (overdue.length === 0) {
        return toolResult('Aucun retour en retard.')
      }

      const lines = overdue.map((r) => {
        const daysLate = Math.ceil((now.getTime() - r.endDate!.getTime()) / (1000 * 60 * 60 * 24))
        return `- **#${r.number}** — ${r.customerFirstName} ${r.customerLastName}\n  Retour prévu le ${formatDate(r.endDate)} (${daysLate}j de retard) — ${formatCurrency(r.totalAmount)}`
      })

      return toolResult(
        `## Retours en retard (${overdue.length})\n\n${lines.join('\n\n')}`
      )
    }
  )

  server.tool(
    'check_availability',
    'Check product availability for a date range',
    {
      productId: z.string().describe('The product ID'),
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async ({ productId, startDate, endDate }) => {
      requirePermission(ctx, 'products', 'read')

      const start = new Date(startDate)
      const end = new Date(endDate)

      const product = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: { id: true, name: true, quantity: true },
      })

      if (!product) return toolResult('Produit non trouvé.')

      // Count overlapping confirmed/ongoing reservations
      const [overlap] = await db
        .select({ count: sql<number>`COALESCE(SUM(${reservationItems.quantity}), 0)` })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(
          and(
            eq(reservationItems.productId, productId),
            eq(reservations.storeId, ctx.storeId),
            sql`${reservations.status} IN ('pending', 'confirmed', 'ongoing')`,
            lte(reservations.startDate, end),
            gte(reservations.endDate, start)
          )
        )

      const reserved = overlap?.count ?? 0
      const available = Math.max(0, product.quantity - reserved)

      return toolResult(
        `## Disponibilité — ${product.name}\n\n` +
          `- Période: ${formatDate(start)} → ${formatDate(end)}\n` +
          `- Stock total: ${product.quantity}\n` +
          `- Réservé: ${reserved}\n` +
          `- **Disponible: ${available}**`
      )
    }
  )
}
