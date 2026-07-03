import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';

import {
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  customers,
  db,
  getBlockingReservationStatuses,
  productUnits,
  products,
  reservationItems,
  reservations,
  stores,
} from '@louez/db';
import {
  computeReservedNetOfExcludedUnits,
  loadExcludedUnitInfo,
} from '@louez/api/services';

import type { McpSessionContext } from '../auth/context';
import { requirePermission } from '../auth/context';
import { toolResult } from '../utils/errors';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../utils/formatting';

export function registerCalendarTools(
  server: McpServer,
  ctx: McpSessionContext,
) {
  server.tool(
    'calendar_upcoming',
    'Get upcoming pickups and returns for the next N days',
    {
      days: z
        .number()
        .optional()
        .describe('Number of days to look ahead (default 7)'),
    },
    async ({ days }) => {
      requirePermission(ctx, 'reservations', 'read');

      const lookAhead = Math.min(days ?? 7, 90);
      const now = new Date();
      const future = new Date();
      future.setDate(future.getDate() + lookAhead);

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
            lte(reservations.startDate, future),
          ),
        )
        .orderBy(reservations.startDate)
        .limit(50);

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
            lte(reservations.endDate, future),
          ),
        )
        .orderBy(reservations.endDate)
        .limit(50);

      let text = `## Calendar — next ${lookAhead} days\n\n`;

      text += `### Upcoming pickups (${pickups.length})\n`;
      if (pickups.length === 0) {
        text += 'No pickups scheduled.\n';
      } else {
        for (const p of pickups) {
          text += `- ${formatDateTime(p.startDate)} — #${p.number} — ${p.customerFirstName} ${p.customerLastName} — ${formatCurrency(p.totalAmount)}\n`;
        }
      }

      text += `\n### Upcoming returns (${returns.length})\n`;
      if (returns.length === 0) {
        text += 'No returns scheduled.\n';
      } else {
        for (const r of returns) {
          text += `- ${formatDateTime(r.endDate)} — #${r.number} — ${r.customerFirstName} ${r.customerLastName} — ${formatCurrency(r.totalAmount)}\n`;
        }
      }

      return toolResult(text);
    },
  );

  server.tool(
    'calendar_overdue',
    'Get overdue returns (ongoing reservations past their end date)',
    {},
    async () => {
      requirePermission(ctx, 'reservations', 'read');

      const now = new Date();

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
            lte(reservations.endDate, now),
          ),
        )
        .orderBy(reservations.endDate)
        .limit(50);

      if (overdue.length === 0) {
        return toolResult('No overdue returns.');
      }

      const lines = overdue.map((r) => {
        const daysLate = Math.ceil(
          (now.getTime() - r.endDate!.getTime()) / (1000 * 60 * 60 * 24),
        );
        return `- **#${r.number}** — ${r.customerFirstName} ${r.customerLastName}\n  Due: ${formatDate(r.endDate)} (${daysLate} day${daysLate !== 1 ? 's' : ''} late) — ${formatCurrency(r.totalAmount)}`;
      });

      return toolResult(
        `## Overdue returns (${overdue.length})\n\n${lines.join('\n\n')}`,
      );
    },
  );

  server.tool(
    'check_availability',
    'Check product availability for a date range',
    {
      productId: z.string().describe('The product ID'),
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async ({ productId, startDate, endDate }) => {
      requirePermission(ctx, 'products', 'read');

      const start = new Date(startDate);
      const end = new Date(endDate);

      const product = await db.query.products.findFirst({
        where: and(
          eq(products.storeId, ctx.storeId),
          eq(products.id, productId),
        ),
        columns: { id: true, name: true, quantity: true, trackUnits: true },
      });

      if (!product) return toolResult('Product not found.');

      const store = await db.query.stores.findFirst({
        where: eq(stores.id, ctx.storeId),
        columns: { settings: true },
      });
      const turnoverBufferMinutes = store?.settings?.turnoverBufferMinutes ?? 0;
      const blockingStatuses = getBlockingReservationStatuses(
        (store?.settings?.pendingBlocksAvailability) ?? true,
      );

      const overlappingReservations = await db.query.reservations.findMany({
        where: and(
          eq(reservations.storeId, ctx.storeId),
          inArray(reservations.status, blockingStatuses),
          buildReservationOverlapPredicate({
            start,
            end,
            turnoverBufferMinutes,
          }),
        ),
        with: {
          items: {
            where: eq(reservationItems.productId, productId),
            columns: {
              productId: true,
              quantity: true,
              combinationKey: true,
            },
            with: {
              assignedUnits: true,
            },
          },
        },
      });

      const trackedUnits = product.trackUnits
        ? await db
            .select({ id: productUnits.id })
            .from(productUnits)
            .where(eq(productUnits.productId, productId))
        : [];
      const rentableUnits = product.trackUnits
        ? await db
            .select({ id: productUnits.id })
            .from(productUnits)
            .where(
              and(
                eq(productUnits.productId, productId),
                buildUnitRentableDuringPredicate(db, start, end),
              ),
            )
        : [];
      const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));
      const excludedProductUnitIds = new Set(
        trackedUnits
          .filter((unit) => !rentableUnitIds.has(unit.id))
          .map((unit) => unit.id),
      );
      const excludedUnitInfo = await loadExcludedUnitInfo(
        db,
        excludedProductUnitIds,
      );
      const { reservedByProduct } = computeReservedNetOfExcludedUnits({
        reservations: overlappingReservations,
        startDate: start,
        endDate: end,
        turnoverBufferMinutes,
        excludedProductUnitIds,
        excludedUnitInfo,
      });
      const reserved = reservedByProduct.get(productId) ?? 0;
      const capacity = product.trackUnits
        ? rentableUnits.length
        : product.quantity;
      const available = Math.max(0, capacity - reserved);

      return toolResult(
        `## Availability — ${product.name}\n\n` +
          `- Period: ${formatDate(start)} → ${formatDate(end)}\n` +
          `- Total stock: ${capacity}\n` +
          `- Reserved: ${reserved}\n` +
          `- Buffer after return: ${turnoverBufferMinutes} min\n` +
          `- **Available: ${available}**`,
      );
    },
  );
}
