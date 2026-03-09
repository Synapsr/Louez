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

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })
      if (!reservation) return toolError('Reservation not found.')

      const rows = await db.query.payments.findMany({
        where: eq(payments.reservationId, reservationId),
        orderBy: [payments.createdAt],
      })

      if (rows.length === 0) {
        return toolResult(`No payments recorded for reservation #${reservation.number}.`)
      }

      const lines = rows.map(
        (p) =>
          `- **${p.type}** — ${formatCurrency(p.amount)}\n` +
          `  Method: ${p.method} | Status: ${p.status}\n` +
          `  ${p.paidAt ? `Paid: ${formatDateTime(p.paidAt)}` : `Created: ${formatDateTime(p.createdAt)}`}` +
          (p.notes ? `\n  Note: ${p.notes}` : '')
      )

      return toolResult(
        `## Payments — Reservation #${reservation.number} (${rows.length})\n\n${lines.join('\n\n')}`
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

      const numAmount = parseFloat(amount)
      if (isNaN(numAmount) || numAmount === 0) {
        return toolError('Amount must be a non-zero number.')
      }
      if (numAmount < 0 && type !== 'adjustment') {
        return toolError('Only "adjustment" payments can have a negative amount.')
      }

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true, status: true },
      })
      if (!reservation) return toolError('Reservation not found.')

      if (reservation.status === 'cancelled' || reservation.status === 'rejected') {
        return toolError(`Cannot record payment on a ${reservation.status} reservation.`)
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

      return toolResult(
        `Payment recorded for reservation #${reservation.number}.\n\n` +
          `- Type: ${type}\n` +
          `- Amount: ${formatCurrency(amount)}\n` +
          `- Method: ${method}`
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

      const payment = await db.query.payments.findFirst({
        where: eq(payments.id, paymentId),
        with: {
          reservation: { columns: { storeId: true, number: true } },
        },
      })

      if (!payment || payment.reservation?.storeId !== ctx.storeId) {
        return toolError('Payment not found.')
      }

      if (payment.method === 'stripe') {
        return toolError('Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.')
      }

      await db.delete(payments).where(eq(payments.id, paymentId))

      return toolResult(`Payment deleted (reservation #${payment.reservation?.number}).`)
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

      const numAmount = parseFloat(amount)
      if (isNaN(numAmount) || numAmount <= 0) {
        return toolError('Amount must be greater than zero.')
      }

      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
        with: { payments: true },
      })
      if (!reservation) return toolError('Reservation not found.')

      const depositCollected = reservation.payments
        .filter((p) => p.type === 'deposit' && p.status === 'completed')
        .reduce((sum, p) => sum + parseFloat(p.amount), 0)
      const depositReturned = reservation.payments
        .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
        .reduce((sum, p) => sum + parseFloat(p.amount), 0)
      const maxReturnable = depositCollected - depositReturned

      if (numAmount > maxReturnable) {
        return toolError(
          `Amount exceeds returnable deposit. ` +
            `Collected: ${formatCurrency(String(depositCollected))}, ` +
            `already returned: ${formatCurrency(String(depositReturned))}, ` +
            `max returnable: ${formatCurrency(String(maxReturnable))}.`
        )
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

      return toolResult(
        `Deposit returned for reservation #${reservation.number}.\n` +
          `- Amount: ${formatCurrency(amount)}\n` +
          `- Method: ${method}`
      )
    }
  )
}
