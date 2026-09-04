import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";

import {
  categories,
  db,
  effectiveProductQuantitySql,
  getEffectiveProductQuantities,
  marketplaceCatalogTombstones,
  lockProductReservationsForStockKindChange,
  productCategories,
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
  reservationItems,
  reservations,
} from "@louez/db";

import type { McpSessionContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { toolError, toolResult } from "../utils/errors";
import { formatCurrency, formatDate } from "../utils/formatting";
import { paginationParams } from "../utils/pagination";

export function registerProductTools(server: McpServer, ctx: McpSessionContext) {
  // ── list_products ──────────────────────────────────────────────────────
  server.tool(
    "list_products",
    "List products in the store catalog with optional filters",
    {
      status: z
        .enum(["active", "draft", "archived", "all"])
        .optional()
        .describe("Filter by product status"),
      categoryId: z.string().optional().describe("Filter by category ID"),
      search: z.string().optional().describe("Search by product name"),
      page: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Results per page (default 50, max 100)"),
    },
    async ({ status, categoryId, search, page, pageSize }) => {
      requirePermission(ctx, "products", "read");
      const { limit, offset } = paginationParams({ page, pageSize });

      const conditions = [eq(products.storeId, ctx.storeId)];
      if (status && status !== "all") {
        conditions.push(eq(products.status, status));
      }
      if (categoryId) {
        conditions.push(
          inArray(
            products.id,
            db
              .select({ id: productCategories.productId })
              .from(productCategories)
              .where(eq(productCategories.categoryId, categoryId)),
          ),
        );
      }
      if (search) {
        conditions.push(like(products.name, `%${search}%`));
      }

      const rows = await db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          deposit: products.deposit,
          pricingKind: products.pricingKind,
          stockKind: products.stockKind,
          pricingMode: products.pricingMode,
          quantity: effectiveProductQuantitySql(),
          status: products.status,
          categoryId: products.categoryId,
          categoryName: categories.name,
          createdAt: products.createdAt,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(...conditions))
        .orderBy(products.displayOrder, products.name)
        .limit(limit)
        .offset(offset);

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(products)
        .where(and(...conditions));

      const lines = rows.map(
        (p) =>
          `- **${p.name}** (${p.id})\n` +
          `  Price: ${formatCurrency(p.price)}${p.pricingKind === "fixed" ? " (fixed)" : `/${p.pricingMode}`} | Deposit: ${formatCurrency(p.deposit ?? "0")} | Stock: ${p.stockKind === "untracked" ? "not tracked" : p.quantity} (${p.stockKind})\n` +
          `  Status: ${p.status}${p.categoryName ? ` | Category: ${p.categoryName}` : ""}`,
      );

      const total = countResult?.total ?? 0;
      return toolResult(
        `## Products (${total} result${total !== 1 ? "s" : ""})\n\n${lines.join("\n\n") || "No products found."}`,
      );
    },
  );

  // ── get_product ────────────────────────────────────────────────────────
  server.tool(
    "get_product",
    "Get detailed information about a specific product",
    {
      productId: z.string().describe("The product ID"),
    },
    async ({ productId }) => {
      requirePermission(ctx, "products", "read");

      const product = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        with: {
          category: true,
          pricingTiers: true,
          units: true,
        },
      });

      if (!product) return toolError("Product not found.");

      const effectiveQuantities = await getEffectiveProductQuantities(db, [product.id]);
      const effectiveQuantity = product.trackUnits
        ? (effectiveQuantities.get(product.id) ?? 0)
        : product.quantity;

      let text =
        `## ${product.name}\n\n` +
        `- **ID**: ${product.id}\n` +
        `- **Status**: ${product.status}\n` +
        `- **Pricing kind**: ${product.pricingKind}\n` +
        `- **Stock kind**: ${product.stockKind}\n` +
        `- **Price**: ${formatCurrency(product.price)}${product.pricingKind === "fixed" ? "" : `/${product.pricingMode}`}\n` +
        `- **Deposit**: ${formatCurrency(product.deposit ?? "0")}\n` +
        `- **Stock**: ${product.stockKind === "untracked" ? "not tracked" : effectiveQuantity}\n` +
        `- **Category**: ${product.category?.name ?? "—"}\n` +
        `- **Unit tracking**: ${product.trackUnits ? "Yes" : "No"}\n` +
        `- **Created**: ${formatDate(product.createdAt)}\n`;

      if (product.description) {
        text += `\n### Description\n${product.description}\n`;
      }

      if (product.pricingKind === "duration" && product.pricingTiers.length > 0) {
        text += `\n### Pricing tiers\n`;
        for (const tier of product.pricingTiers) {
          const duration = tier.minDuration ?? tier.period ?? "—";
          text += `- ${duration}+ duration: ${formatCurrency(tier.price ?? "0")}/${product.pricingMode}\n`;
        }
      }

      if (product.units.length > 0) {
        text += `\n### Units (${product.units.length})\n`;
        for (const unit of product.units) {
          text += `- ${unit.identifier} — ${unit.lifecycleStatus}\n`;
        }
      }

      return toolResult(text);
    },
  );

  // ── create_product ─────────────────────────────────────────────────────
  server.tool(
    "create_product",
    "Create a new product in the catalog",
    {
      name: z.string().min(1).describe("Product name"),
      description: z.string().optional().describe("Product description"),
      price: z.string().describe('Price per period or fixed unit price (e.g. "25.00")'),
      deposit: z.string().optional().describe('Deposit amount (e.g. "100.00")'),
      pricingKind: z
        .enum(["duration", "fixed"])
        .default("duration")
        .describe("Whether pricing depends on rental duration"),
      stockKind: z
        .enum(["returnable", "consumable", "untracked"])
        .default("returnable")
        .describe("Whether stock returns, is consumed, or is not quantity-limited"),
      pricingMode: z
        .enum(["hour", "day", "week"])
        .default("day")
        .describe("Pricing period for duration products"),
      quantity: z.number().int().min(1).optional().describe("Stock quantity (default 1)"),
      categoryId: z.string().optional().describe("Category ID"),
    },
    async ({
      name,
      description,
      price,
      deposit,
      pricingKind,
      stockKind,
      pricingMode,
      quantity,
      categoryId,
    }) => {
      requirePermission(ctx, "products", "write");

      if (stockKind === "consumable" && pricingKind !== "fixed") {
        return toolError("Consumable products must use fixed pricing.");
      }

      const [created] = await db
        .insert(products)
        .values({
          storeId: ctx.storeId,
          name,
          description: description ?? null,
          price,
          deposit: deposit ?? "0",
          pricingKind,
          stockKind,
          pricingMode,
          basePeriodMinutes: null,
          enforceStrictTiers: false,
          quantity: quantity ?? 1,
          categoryId: categoryId ?? null,
          status: "active",
        })
        .$returningId();

      if (categoryId) {
        await db.insert(productCategories).values({
          productId: created.id,
          categoryId,
          position: 0,
        });
      }

      return toolResult(
        `Product created successfully.\n\n` +
          `- **Name**: ${name}\n` +
          `- **ID**: ${created.id}\n` +
          `- **Pricing kind**: ${pricingKind}\n` +
          `- **Stock kind**: ${stockKind}\n` +
          `- **Price**: ${formatCurrency(price)}${pricingKind === "fixed" ? "" : `/${pricingMode}`}\n` +
          `- **Stock**: ${stockKind === "untracked" ? "not tracked" : (quantity ?? 1)}`,
      );
    },
  );

  // ── update_product ─────────────────────────────────────────────────────
  server.tool(
    "update_product",
    "Update an existing product",
    {
      productId: z.string().describe("The product ID to update"),
      name: z.string().optional().describe("New product name"),
      description: z.string().optional().describe("New description"),
      price: z.string().optional().describe("New price"),
      deposit: z.string().optional().describe("New deposit amount"),
      pricingKind: z.enum(["duration", "fixed"]).optional().describe("New pricing behavior"),
      stockKind: z
        .enum(["returnable", "consumable", "untracked"])
        .optional()
        .describe("New stock behavior"),
      quantity: z.number().int().optional().describe("New stock quantity"),
      status: z.enum(["active", "draft", "archived"]).optional().describe("New status"),
    },
    async ({ productId, ...updates }) => {
      requirePermission(ctx, "products", "write");

      const existing = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: {
          id: true,
          pricingKind: true,
          status: true,
          stockKind: true,
          trackUnits: true,
        },
      });
      if (!existing) return toolError("Product not found.");
      if (existing.trackUnits && updates.quantity !== undefined) {
        return toolError("Quantity is derived from active units for unit-tracked products.");
      }
      const nextPricingKind = updates.pricingKind ?? existing.pricingKind;
      const nextStockKind = updates.stockKind ?? existing.stockKind;
      if (nextStockKind === "consumable" && (nextPricingKind !== "fixed" || existing.trackUnits)) {
        return toolError("Consumable products must use fixed pricing and cannot track units.");
      }
      if (nextStockKind === "untracked" && existing.trackUnits) {
        return toolError("Untracked products cannot track individual units.");
      }

      const updateData: Partial<typeof products.$inferInsert> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.price !== undefined) updateData.price = updates.price;
      if (updates.deposit !== undefined) updateData.deposit = updates.deposit;
      if (updates.pricingKind !== undefined) {
        updateData.pricingKind = updates.pricingKind;
        if (updates.pricingKind === "fixed") {
          updateData.basePeriodMinutes = null;
          updateData.enforceStrictTiers = false;
        }
      }
      if (updates.stockKind !== undefined) {
        updateData.stockKind = updates.stockKind;
      }
      if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
      if (updates.status !== undefined) updateData.status = updates.status;

      if (Object.keys(updateData).length === 0) {
        return toolError("No fields to update.");
      }
      updateData.updatedAt = new Date();

      const updateResult = await db.transaction(async (tx) => {
        const canChangeStockKind =
          updates.stockKind === undefined
            ? true
            : await lockProductReservationsForStockKindChange(tx, {
                productId,
                storeId: ctx.storeId,
              });
        const [lockedProduct] = await tx
          .select({
            pricingKind: products.pricingKind,
            stockKind: products.stockKind,
            trackUnits: products.trackUnits,
          })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId)))
          .for("update");

        if (!lockedProduct) {
          return { ok: false as const, error: "Product not found." };
        }

        const lockedNextPricingKind = updates.pricingKind ?? lockedProduct.pricingKind;
        const lockedNextStockKind = updates.stockKind ?? lockedProduct.stockKind;
        if (
          lockedNextStockKind === "consumable" &&
          (lockedNextPricingKind !== "fixed" || lockedProduct.trackUnits)
        ) {
          return {
            ok: false as const,
            error: "Consumable products must use fixed pricing and cannot track units.",
          };
        }
        if (lockedNextStockKind === "untracked" && lockedProduct.trackUnits) {
          return {
            ok: false as const,
            error: "Untracked products cannot track individual units.",
          };
        }
        if (lockedProduct.trackUnits && updates.quantity !== undefined) {
          return {
            ok: false as const,
            error: "Quantity is derived from active units for unit-tracked products.",
          };
        }
        if (lockedProduct.stockKind !== lockedNextStockKind && !canChangeStockKind) {
          return {
            ok: false as const,
            error:
              "Stock kind cannot change while the product is used by a confirmed or ongoing reservation.",
          };
        }

        await tx
          .update(products)
          .set(updateData)
          .where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId)));

        if (updates.pricingKind === "fixed") {
          await tx.delete(productPricingTiers).where(eq(productPricingTiers.productId, productId));

          const seasonalPricings = await tx
            .select({ id: productSeasonalPricing.id })
            .from(productSeasonalPricing)
            .where(eq(productSeasonalPricing.productId, productId));
          const seasonalPricingIds = seasonalPricings.map(({ id }) => id);

          if (seasonalPricingIds.length > 0) {
            await tx
              .delete(productSeasonalPricingTiers)
              .where(inArray(productSeasonalPricingTiers.seasonalPricingId, seasonalPricingIds));
          }

          await tx
            .delete(productSeasonalPricing)
            .where(eq(productSeasonalPricing.productId, productId));
        }

        if (
          existing.status === "active" &&
          updates.status !== undefined &&
          updates.status !== "active"
        ) {
          await tx.insert(marketplaceCatalogTombstones).values({
            entityType: "product",
            entityId: productId,
            deletedAt: new Date(),
          });
        }

        return { ok: true as const };
      });

      if (!updateResult.ok) {
        return toolError(updateResult.error);
      }

      return toolResult(`Product ${productId} updated successfully.`);
    },
  );

  // ── archive_product ────────────────────────────────────────────────────
  server.tool(
    "archive_product",
    "Archive a product (soft delete)",
    {
      productId: z.string().describe("The product ID to archive"),
    },
    async ({ productId }) => {
      requirePermission(ctx, "products", "write");

      const existing = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: { id: true, name: true, status: true },
      });
      if (!existing) return toolError("Product not found.");

      const [activeCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(
          and(
            eq(reservationItems.productId, productId),
            inArray(reservations.status, ["pending", "confirmed", "ongoing"] as const),
          ),
        );

      if (activeCount && activeCount.count > 0) {
        return toolError(
          `Cannot archive "${existing.name}": ${activeCount.count} active reservation(s) use this product.`,
        );
      }

      await db.transaction(async (tx) => {
        await tx
          .update(products)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(products.id, productId));

        if (existing.status === "active") {
          await tx.insert(marketplaceCatalogTombstones).values({
            entityType: "product",
            entityId: productId,
            deletedAt: new Date(),
          });
        }
      });

      return toolResult(`Product "${existing.name}" archived successfully.`);
    },
  );
}
