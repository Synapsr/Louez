import { z } from 'zod'
import { reservationLinks } from '@louez/api/platform/links'
import { db, markReservation, payments, reservations, stores, type Transaction } from '@louez/db'
import type { StoreSettings } from '@louez/types'
import { depositHoldRowKind, describeDepositHoldRow } from '@louez/utils'
import { and, eq } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'

import { hasPermission, type McpRequestContext } from '../auth/context'
import { formatCurrency, formatDateTime } from '../utils/formatting'
import { toolError, toolResult } from '../utils/errors'
import { legacyTool } from '../utils/legacy-tool'
import { linksLine } from '../utils/links'

/**
 * A payment row's status as an agent reads it. A deposit hold's own status follows
 * Stripe, and says neither that an authorization was never confirmed nor that it is a
 * second one being released: its kind does.
 */
export const paymentStatusLine = (row: {
  type: string
  status: string
  releaseOwedAt?: Date | string | null
}): string => {
  const kind = depositHoldRowKind(row)
  return kind ? describeDepositHoldRow(kind) : row.status
}

/** A payment the store records by hand, as the app's writer takes it. */
export interface McpRecordedPayment {
  reservationId: string
  storeId: string
  storeSettings: Pick<StoreSettings, 'currency' | 'tax'> | null
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'adjustment'
  method: 'cash' | 'card' | 'transfer' | 'check' | 'other'
  /** As stored, `decimal(10,2)`. */
  amount: string
  /** `deposit` for a deposit given back, `manual` otherwise. */
  origin: 'manual' | 'deposit'
  paidAt: Date
  notes: string | null
}

/** What the payment tools take from the app. packages/mcp cannot import apps/web. */
export interface McpPaymentDeps {
  /**
   * The dashboard's writer, in the caller's transaction: the payment, under a new id,
   * in the reservation's currency with its billing facts (gross, insurance share), and
   * the reservation's mark for the billing service.
   */
  insertRecordedPayment: (tx: Transaction, payment: McpRecordedPayment) => Promise<void>
}

/**
 * The line with a reservation's dashboard link, after a blank line; empty
 * unless the connection may read reservations, as the link names its id.
 */
function reservationLinkLine(ctx: McpRequestContext, reservation: { id: string }): string {
  if (!hasPermission(ctx, 'reservations', 'read')) return ''
  return `\n\n${linksLine(reservationLinks(ctx.ports.urls, { id: ctx.storeId }, reservation))}`
}

async function loadStoreSettings(storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true },
  })
  return store?.settings ?? null
}

export function registerPaymentTools(
  server: McpServer,
  ctx: McpRequestContext,
  deps: McpPaymentDeps
) {
  legacyTool(
    server,
    ctx,
    { domain: 'payments', level: 'read' },
    { name: 'list_payments', title: 'List Payments' },
    "List all payments for a specific reservation, with the link to the reservation's dashboard page to give the user when the connection may read reservations.",
    {
      reservationId: z.string().describe('The reservation ID'),
    },
    async ({ reservationId }) => {
      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          eq(reservations.id, reservationId)
        ),
        columns: { id: true, number: true },
      })
      if (!reservation) return toolError('Reservation not found.', 'NOT_FOUND')
      const links = reservationLinkLine(ctx, reservation)

      const rows = await db.query.payments.findMany({
        where: eq(payments.reservationId, reservationId),
        orderBy: [payments.createdAt],
      })

      if (rows.length === 0) {
        return toolResult(`No payments recorded for reservation #${reservation.number}.${links}`)
      }

      const lines = rows.map(
        (p) =>
          `- **${p.type}** — ${formatCurrency(p.amount)}\n` +
          `  Method: ${p.method} | Status: ${paymentStatusLine(p)}\n` +
          `  ${p.paidAt ? `Paid: ${formatDateTime(p.paidAt)}` : `Created: ${formatDateTime(p.createdAt)}`}` +
          (p.notes ? `\n  Note: ${p.notes}` : '')
      )

      return toolResult(
        `## Payments — Reservation #${reservation.number} (${rows.length})\n\n${lines.join('\n\n')}${links}`
      )
    }
  )

  legacyTool(
    server,
    ctx,
    { domain: 'payments', level: 'write' },
    { name: 'record_payment', title: 'Record Payment', effect: 'additive' },
    "Record a manual payment for a reservation. Answers with the link to the reservation's dashboard page, to give the user, when the connection may read reservations.",
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
      if (!reservation) return toolError('Reservation not found.', 'NOT_FOUND')

      if (reservation.status === 'cancelled' || reservation.status === 'rejected') {
        return toolError(`Cannot record payment on a ${reservation.status} reservation.`)
      }

      const storeSettings = await loadStoreSettings(ctx.storeId)
      await db.transaction((tx) =>
        deps.insertRecordedPayment(tx, {
          reservationId,
          storeId: ctx.storeId,
          storeSettings,
          type,
          method,
          amount,
          origin: 'manual',
          paidAt: new Date(),
          notes: notes ?? null,
        })
      )

      return toolResult(
        `Payment recorded for reservation #${reservation.number}.\n\n` +
          `- Type: ${type}\n` +
          `- Amount: ${formatCurrency(amount)}\n` +
          `- Method: ${method}` +
          reservationLinkLine(ctx, reservation)
      )
    },
    {
      sensitive: {
        kind: 'money',
        always: true,
        confirm: async ({ reservationId, type, amount, method }) => {
          const reservation = await db.query.reservations.findFirst({
            where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
            columns: { number: true, status: true },
          })
          if (!reservation) return null
          return {
            preview: {
              summary: `Record a ${type} payment of ${formatCurrency(amount)} (${method}) on reservation #${reservation.number}.`,
              details: { reservationId, number: reservation.number, type, amount, method },
            },
            state: { status: reservation.status },
          }
        },
      },
    }
  )

  legacyTool(
    server,
    ctx,
    { domain: 'payments', level: 'write' },
    { name: 'delete_payment', title: 'Delete Payment', effect: 'delete' },
    "Delete a payment record. Answers with the link to the reservation's dashboard page, to give the user, when the connection may read reservations.",
    {
      paymentId: z.string().describe('The payment ID to delete'),
    },
    async ({ paymentId }) => {
      const payment = await db.query.payments.findFirst({
        where: eq(payments.id, paymentId),
        with: {
          reservation: { columns: { storeId: true, number: true } },
        },
      })

      if (!payment || payment.reservation?.storeId !== ctx.storeId) {
        return toolError('Payment not found.', 'NOT_FOUND')
      }

      if (payment.method === 'stripe') {
        return toolError('Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.')
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(payments)
          .where(and(eq(payments.id, paymentId), eq(payments.reservationId, payment.reservationId)))
        await markReservation(tx, { id: payment.reservationId, storeId: ctx.storeId })
      })

      return toolResult(
        `Payment deleted (reservation #${payment.reservation?.number}).` +
          reservationLinkLine(ctx, { id: payment.reservationId })
      )
    },
    {
      sensitive: {
        kind: 'destructive',
        always: true,
        confirm: async ({ paymentId }) => {
          const payment = await db.query.payments.findFirst({
            where: eq(payments.id, paymentId),
            columns: { amount: true, type: true, method: true, status: true },
            with: { reservation: { columns: { storeId: true, number: true } } },
          })
          if (!payment || payment.reservation?.storeId !== ctx.storeId) return null
          return {
            preview: {
              summary: `Delete the ${payment.type} payment of ${formatCurrency(payment.amount)} (${payment.method}) on reservation #${payment.reservation.number}.`,
              details: {
                paymentId,
                number: payment.reservation.number,
                type: payment.type,
                amount: payment.amount,
                method: payment.method,
              },
            },
            state: { amount: payment.amount, status: payment.status },
          }
        },
      },
    }
  )

  legacyTool(
    server,
    ctx,
    { domain: 'payments', level: 'write' },
    { name: 'record_deposit_return', title: 'Record Deposit Return', effect: 'additive' },
    "Record a deposit return the store has already made: adds it to the reservation's payments, as the amount given back and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused above the deposit collected and not yet returned. Answers with the link to the reservation's dashboard page, to give the user, when the connection may read reservations.",
    {
      reservationId: z.string().describe('The reservation ID'),
      amount: z.string().describe('Amount given back'),
      method: z
        .enum(['cash', 'card', 'transfer', 'check', 'other'])
        .describe('How the deposit was given back'),
      notes: z.string().optional().describe('Optional notes'),
    },
    async ({ reservationId, amount, method, notes }) => {
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
      if (!reservation) return toolError('Reservation not found.', 'NOT_FOUND')

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

      const storeSettings = await loadStoreSettings(ctx.storeId)
      await db.transaction((tx) =>
        deps.insertRecordedPayment(tx, {
          reservationId,
          storeId: ctx.storeId,
          storeSettings,
          type: 'deposit_return',
          method,
          amount,
          origin: 'deposit',
          paidAt: new Date(),
          notes: notes ?? null,
        })
      )

      return toolResult(
        `Deposit return recorded for reservation #${reservation.number}.\n` +
          `- Amount: ${formatCurrency(amount)}\n` +
          `- Method: ${method}` +
          reservationLinkLine(ctx, reservation)
      )
    },
    {
      sensitive: {
        kind: 'money',
        always: true,
        confirm: async ({ reservationId, amount, method }) => {
          const reservation = await db.query.reservations.findFirst({
            where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
            columns: { number: true },
            with: { payments: { columns: { type: true, status: true, amount: true } } },
          })
          if (!reservation) return null
          const completed = (kind: string) =>
            reservation.payments
              .filter((p) => p.type === kind && p.status === 'completed')
              .reduce((sum, p) => sum + parseFloat(p.amount), 0)
          const returnable = completed('deposit') - completed('deposit_return')
          return {
            preview: {
              summary: `Record a deposit return of ${formatCurrency(amount)} (${method}) on reservation #${reservation.number}.`,
              details: {
                reservationId,
                number: reservation.number,
                amount,
                method,
                returnable: returnable.toFixed(2),
              },
            },
            state: { returnable: returnable.toFixed(2) },
          }
        },
      },
    }
  )
}
