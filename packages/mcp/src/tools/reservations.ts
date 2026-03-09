import { z } from 'zod'
import { db, reservations, customers, reservationItems, payments } from '@louez/db'
import { and, eq, desc, like, sql, gte, lte } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate, formatDateTime, formatStatus } from '../utils/formatting'
import { toolError, toolResult } from '../utils/errors'
import { paginationParams } from '../utils/pagination'

export function registerReservationTools(server: McpServer, ctx: McpSessionContext) {
  // ── list_reservations ──────────────────────────────────────────────────
  server.tool(
    'list_reservations',
    'List reservations with optional filters (status, period, search)',
    {
      status: z
        .enum(['pending', 'confirmed', 'ongoing', 'completed', 'cancelled', 'rejected'])
        .optional()
        .describe('Filter by status'),
      period: z.enum(['today', 'week', 'month']).optional().describe('Filter by time period'),
      search: z.string().optional().describe('Search by reservation number or customer name'),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async ({ status, period, search, page, pageSize }) => {
      requirePermission(ctx, 'reservations', 'read')
      const { limit, offset } = paginationParams({ page, pageSize })

      const conditions = [eq(reservations.storeId, ctx.storeId)]

      if (status) {
        conditions.push(eq(reservations.status, status))
      }

      if (period) {
        const now = new Date()
        const start = new Date(now)
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
          ))`
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
          createdAt: reservations.createdAt,
        })
        .from(reservations)
        .leftJoin(customers, eq(reservations.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(reservations.createdAt))
        .limit(limit)
        .offset(offset)

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(reservations)
        .where(and(...conditions))

      const total = countResult?.total ?? 0

      const lines = rows.map(
        (r) =>
          `- **#${r.number}** (${r.id}) — ${formatStatus(r.status)}\n` +
          `  Client: ${r.customerFirstName} ${r.customerLastName}\n` +
          `  Période: ${formatDate(r.startDate)} → ${formatDate(r.endDate)}\n` +
          `  Montant: ${formatCurrency(r.totalAmount)}`
      )

      return toolResult(
        `## Réservations (${total} résultat${total > 1 ? 's' : ''})\n\n${lines.join('\n\n') || 'Aucune réservation trouvée.'}`
      )
    }
  )

  // ── get_reservation ────────────────────────────────────────────────────
  server.tool(
    'get_reservation',
    'Get complete details of a specific reservation',
    {
      reservationId: z.string().describe('The reservation ID'),
    },
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

      if (!reservation) return toolError('Réservation non trouvée.')

      let text =
        `## Réservation #${reservation.number}\n\n` +
        `- **ID**: ${reservation.id}\n` +
        `- **Statut**: ${formatStatus(reservation.status)}\n` +
        `- **Période**: ${formatDateTime(reservation.startDate)} → ${formatDateTime(reservation.endDate)}\n` +
        `- **Source**: ${reservation.source}\n` +
        `- **Créée le**: ${formatDateTime(reservation.createdAt)}\n`

      // Customer
      const c = reservation.customer
      if (c) {
        text +=
          `\n### Client\n` +
          `- ${c.firstName} ${c.lastName} (${c.customerType})\n` +
          `- Email: ${c.email}\n` +
          (c.phone ? `- Tél: ${c.phone}\n` : '')
      }

      // Items
      text += `\n### Articles (${reservation.items.length})\n`
      for (const item of reservation.items) {
        const productName = item.product?.name ?? item.productSnapshot?.name ?? 'Article personnalisé'
        text += `- ${productName} × ${item.quantity} — ${formatCurrency(item.totalPrice)}\n`
      }

      // Amounts
      text +=
        `\n### Montants\n` +
        `- Sous-total: ${formatCurrency(reservation.subtotalAmount)}\n` +
        `- Caution: ${formatCurrency(reservation.depositAmount)}\n` +
        (reservation.discountAmount && parseFloat(reservation.discountAmount) > 0
          ? `- Remise: -${formatCurrency(reservation.discountAmount)}\n`
          : '') +
        (reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0
          ? `- Livraison: ${formatCurrency(reservation.deliveryFee)}\n`
          : '') +
        `- **Total**: ${formatCurrency(reservation.totalAmount)}\n`

      // Payments
      if (reservation.payments.length > 0) {
        text += `\n### Paiements (${reservation.payments.length})\n`
        for (const p of reservation.payments) {
          text += `- ${p.type} — ${formatCurrency(p.amount)} (${p.method}, ${p.status})\n`
        }
      }

      // Delivery
      if (reservation.deliveryOption === 'delivery' && reservation.deliveryAddress) {
        text += `\n### Livraison\n- ${reservation.deliveryAddress}, ${reservation.deliveryCity} ${reservation.deliveryPostalCode}\n`
      }

      // Notes
      if (reservation.internalNotes) {
        text += `\n### Notes internes\n${reservation.internalNotes}\n`
      }
      if (reservation.customerNotes) {
        text += `\n### Notes client\n${reservation.customerNotes}\n`
      }

      return toolResult(text)
    }
  )

  // ── update_reservation_status ──────────────────────────────────────────
  server.tool(
    'update_reservation_status',
    'Change the status of a reservation (confirm, reject, cancel, etc.)',
    {
      reservationId: z.string().describe('The reservation ID'),
      status: z
        .enum(['confirmed', 'ongoing', 'completed', 'cancelled', 'rejected'])
        .describe('The new status'),
      rejectionReason: z.string().optional().describe('Reason for rejection'),
    },
    async ({ reservationId, status: newStatus, rejectionReason }) => {
      requirePermission(ctx, 'reservations', 'write')

      const existing = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true, status: true },
      })

      if (!existing) return toolError('Réservation non trouvée.')

      // Basic status transition validation
      const validTransitions: Record<string, string[]> = {
        pending: ['confirmed', 'rejected', 'cancelled'],
        confirmed: ['ongoing', 'cancelled'],
        ongoing: ['completed'],
      }
      const allowed = validTransitions[existing.status]
      if (!allowed?.includes(newStatus)) {
        return toolError(
          `Transition impossible: ${existing.status} → ${newStatus}. ` +
            `Transitions autorisées: ${allowed?.join(', ') ?? 'aucune'}`
        )
      }

      const updateData: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'ongoing') updateData.pickedUpAt = new Date()
      if (newStatus === 'completed') updateData.returnedAt = new Date()

      await db.update(reservations).set(updateData).where(eq(reservations.id, reservationId))

      return toolResult(
        `Réservation #${existing.number} mise à jour: ${formatStatus(existing.status)} → ${formatStatus(newStatus)}`
      )
    }
  )

  // ── update_reservation_notes ───────────────────────────────────────────
  server.tool(
    'update_reservation_notes',
    'Update internal notes on a reservation',
    {
      reservationId: z.string().describe('The reservation ID'),
      notes: z.string().describe('The new internal notes content'),
    },
    async ({ reservationId, notes }) => {
      requirePermission(ctx, 'reservations', 'write')

      const existing = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })

      if (!existing) return toolError('Réservation non trouvée.')

      await db
        .update(reservations)
        .set({ internalNotes: notes })
        .where(eq(reservations.id, reservationId))

      return toolResult(`Notes mises à jour pour la réservation #${existing.number}.`)
    }
  )

  // ── get_reservation_poll ───────────────────────────────────────────────
  server.tool(
    'get_reservation_poll',
    'Get quick reservation counters by status (pending, ongoing, etc.)',
    {},
    async () => {
      requirePermission(ctx, 'reservations', 'read')

      const rows = await db
        .select({
          status: reservations.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(reservations)
        .where(eq(reservations.storeId, ctx.storeId))
        .groupBy(reservations.status)

      const counts: Record<string, number> = {}
      for (const row of rows) {
        counts[row.status] = row.count
      }

      const lines = Object.entries(counts)
        .map(([status, count]) => `- ${formatStatus(status)}: ${count}`)
        .join('\n')

      const total = Object.values(counts).reduce((a, b) => a + b, 0)

      return toolResult(`## Compteurs réservations (${total} total)\n\n${lines}`)
    }
  )
}
