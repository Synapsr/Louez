import type { McpServer } from "@modelcontextprotocol/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  db,
  getBlockingReservationStatuses,
  loadConsumableReservedQuantities,
  productUnits,
  products,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";
import { computeReservedNetOfExcludedUnits, loadExcludedUnitInfo } from "@louez/api/services";

import type { McpRequestContext } from "../auth/context";
import { toolResult } from "../utils/errors";
import { legacyTool } from "../utils/legacy-tool";
import { formatDate } from "../utils/formatting";

export function registerCalendarTools(server: McpServer, ctx: McpRequestContext) {
  legacyTool(
    server,
    ctx,
    { domain: "products", level: "read" },
    "check_availability",
    "Check product availability for a date range",
    {
      productId: z.string().describe("The product ID"),
      startDate: z.string().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().describe("End date (YYYY-MM-DD)"),
    },
    async ({ productId, startDate, endDate }) => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      const product = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: {
          id: true,
          name: true,
          quantity: true,
          trackUnits: true,
          stockKind: true,
        },
      });

      if (!product) return toolResult("Product not found.");

      const store = await db.query.stores.findFirst({
        where: eq(stores.id, ctx.storeId),
        columns: { settings: true },
      });
      const turnoverBufferMinutes = store?.settings?.turnoverBufferMinutes ?? 0;
      const blockingStatuses = getBlockingReservationStatuses(
        store?.settings?.pendingBlocksAvailability ?? true,
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
          activity: { columns: { metadata: true } },
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
        trackedUnits.filter((unit) => !rentableUnitIds.has(unit.id)).map((unit) => unit.id),
      );
      const excludedUnitInfo = await loadExcludedUnitInfo(db, excludedProductUnitIds);
      const { reservedByProduct } = computeReservedNetOfExcludedUnits({
        reservations: overlappingReservations,
        startDate: start,
        endDate: end,
        turnoverBufferMinutes,
        excludedProductUnitIds,
        excludedUnitInfo,
        consumableProductIds:
          product.stockKind === "consumable" ? new Set([product.id]) : undefined,
      });
      if (product.stockKind === "consumable") {
        const consumableReservedByProduct = await loadConsumableReservedQuantities(db, {
          storeId: ctx.storeId,
          productIds: [product.id],
          blockingStatuses,
        });
        reservedByProduct.set(product.id, consumableReservedByProduct.get(product.id) ?? 0);
      }
      const reserved = reservedByProduct.get(productId) ?? 0;
      const capacity = product.trackUnits
        ? rentableUnits.length
        : product.stockKind === "untracked"
          ? null
          : product.quantity;
      const available = capacity === null ? null : Math.max(0, capacity - reserved);

      return toolResult(
        `## Availability — ${product.name}\n\n` +
          `- Period: ${formatDate(start)} → ${formatDate(end)}\n` +
          `- Total stock: ${capacity === null ? "not tracked" : capacity}\n` +
          `- Reserved: ${capacity === null ? "not applicable" : reserved}\n` +
          `- Buffer after return: ${turnoverBufferMinutes} min\n` +
          `- **Available: ${available === null ? "not quantity-limited" : available}**`,
      );
    },
  );
}
