import { z } from 'zod'
import { reservationLinks } from '@louez/api/platform/links'
import { db, payments, reservations } from '@louez/db'
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

/**
 * The line with a reservation's dashboard link, after a blank line; empty
 * unless the connection may read reservations, as the link names its id.
 */
function reservationLinkLine(ctx: McpRequestContext, reservation: { id: string }): string {
  if (!hasPermission(ctx, 'reservations', 'read')) return ''
  return `\n\n${linksLine(reservationLinks(ctx.ports.urls, { id: ctx.storeId }, reservation))}`
}

/**
 * The payments' hand-written read. The writes (record_payment,
 * record_deposit_return, delete_payment) are procedures
 * (routers/dashboard/payments.ts in packages/api).
 */
export function registerPaymentTools(server: McpServer, ctx: McpRequestContext) {
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
}
