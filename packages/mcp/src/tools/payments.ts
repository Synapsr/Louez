import { z } from 'zod'
import { db, payments, reservations } from '@louez/db'
import { and, eq } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDateTime } from '../utils/formatting'
import { toolError, toolResult } from '../utils/errors'

export function registerPaymentTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'list_payments',
    'List all payments for a specific reservation',
    {
      reservationId: z.string().describe('The reservation ID'),
    },
    async ({ reservationId }) => {
      requirePermission(ctx, 'payments', 'read')

      // Verify reservation belongs to store
      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })
      if (!reservation) return toolError('Réservation non trouvée.')

      const rows = await db.query.payments.findMany({
        where: eq(payments.reservationId, reservationId),
        orderBy: [payments.createdAt],
      })

      if (rows.length === 0) {
        return toolResult(`Aucun paiement enregistré pour la réservation #${reservation.number}.`)
      }

      const lines = rows.map(
        (p) =>
          `- **${p.type}** — ${formatCurrency(p.amount)}\n` +
          `  Méthode: ${p.method} | Statut: ${p.status}\n` +
          `  ${p.paidAt ? `Payé le ${formatDateTime(p.paidAt)}` : `Créé le ${formatDateTime(p.createdAt)}`}` +
          (p.notes ? `\n  Note: ${p.notes}` : '')
      )

      return toolResult(
        `## Paiements — Réservation #${reservation.number} (${rows.length})\n\n${lines.join('\n\n')}`
      )
    }
  )

  server.tool(
    'record_payment',
    'Record a manual payment for a reservation',
    {
      reservationId: z.string().describe('The reservation ID'),
      type: z
        .enum(['rental', 'deposit', 'deposit_return', 'damage', 'adjustment'])
        .describe('Payment type'),
      amount: z.string().describe('Amount (e.g. "150.00")'),
      method: z
        .enum(['cash', 'card', 'transfer', 'check', 'other'])
        .describe('Payment method'),
      notes: z.string().optional().describe('Optional notes'),
    },
    async ({ reservationId, type, amount, method, notes }) => {
      requirePermission(ctx, 'payments', 'write')

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })
      if (!reservation) return toolError('Réservation non trouvée.')

      await db.insert(payments).values({
        reservationId,
        type,
        amount,
        method,
        status: 'completed',
        paidAt: new Date(),
        notes: notes ?? null,
      })

      return toolResult(
        `Paiement enregistré pour la réservation #${reservation.number}.\n\n` +
          `- Type: ${type}\n` +
          `- Montant: ${formatCurrency(amount)}\n` +
          `- Méthode: ${method}`
      )
    }
  )

  server.tool(
    'delete_payment',
    'Delete a payment record',
    {
      paymentId: z.string().describe('The payment ID to delete'),
    },
    async ({ paymentId }) => {
      requirePermission(ctx, 'payments', 'write')

      // Verify payment belongs to a reservation in this store
      const payment = await db.query.payments.findFirst({
        where: eq(payments.id, paymentId),
        with: {
          reservation: { columns: { storeId: true, number: true } },
        },
      })

      if (!payment || payment.reservation?.storeId !== ctx.storeId) {
        return toolError('Paiement non trouvé.')
      }

      await db.delete(payments).where(eq(payments.id, paymentId))

      return toolResult(`Paiement supprimé (réservation #${payment.reservation?.number}).`)
    }
  )

  server.tool(
    'return_deposit',
    'Record a deposit return for a reservation',
    {
      reservationId: z.string().describe('The reservation ID'),
      amount: z.string().describe('Amount to return'),
      method: z.enum(['cash', 'card', 'transfer', 'check', 'other']).describe('Return method'),
      notes: z.string().optional().describe('Optional notes'),
    },
    async ({ reservationId, amount, method, notes }) => {
      requirePermission(ctx, 'payments', 'write')

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })
      if (!reservation) return toolError('Réservation non trouvée.')

      await db.insert(payments).values({
        reservationId,
        type: 'deposit_return',
        amount,
        method,
        status: 'completed',
        paidAt: new Date(),
        notes: notes ?? null,
      })

      return toolResult(
        `Caution restituée pour la réservation #${reservation.number}.\n` +
          `- Montant: ${formatCurrency(amount)}\n` +
          `- Méthode: ${method}`
      )
    }
  )
}
