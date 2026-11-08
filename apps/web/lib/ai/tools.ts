import { tool } from "ai";
import { and, desc, eq, exists, gte, inArray, lte, or, sql, sum } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  customers,
  dailyStats,
  db,
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  getBlockingReservationStatuses,
  loadConsumableReservedQuantities,
  payments,
  productStats,
  productUnits,
  products,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";
import type { AppRouter } from "@louez/api";
import type { ApiKeyPermissions } from "@louez/db/schema";
import type { RouterClient } from "@orpc/server";
import { computeReservedNetOfExcludedUnits, loadExcludedUnitInfo } from "@louez/api/services";
import {
  customerFieldSearchCondition,
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from "@louez/api/services/customer-fields";
import {
  checkCustomerFieldEntries,
  toReadableCustomerFields,
} from "@louez/api/services/customer-tools";

import {
  deleteRecordedPayment,
  insertRecordedPayment,
} from "@/lib/reservations/dashboard-payment-writes";

// ---------------------------------------------------------------------------
// Context & permissions
// ---------------------------------------------------------------------------

export type AIChatContext = {
  storeId: string;
  /** The signed-in dashboard user the assistant acts for. */
  userId: string;
  storeName: string;
  permissions: ApiKeyPermissions;
  /**
   * The agent-ready procedures, called as the signed-in user (their session,
   * their current role), like the dashboard calls them. Domains move here as
   * they migrate (docs/architecture/api-and-agents.md).
   */
  api?: AssistantApi;
};

/** The procedures the assistant calls, through a server-side client bound to the user's session. */
export type AssistantApi = {
  categories: RouterClient<AppRouter["dashboard"]["categories"]>;
  products: RouterClient<AppRouter["dashboard"]["products"]>;
  reservations: RouterClient<AppRouter["dashboard"]["reservations"]>;
};

function assistantApi(ctx: AIChatContext): AssistantApi {
  if (!ctx.api) throw new Error("The assistant has no API client for this request.");
  return ctx.api;
}

function requirePermission(
  ctx: AIChatContext,
  domain: keyof ApiKeyPermissions,
  level: "read" | "write",
) {
  const perm = ctx.permissions[domain];
  if (perm === "none") {
    throw new Error(`Permission denied: requires ${domain}:${level}`);
  }
  if (level === "write" && perm === "read") {
    throw new Error(`Permission denied: requires ${domain}:write (current: read)`);
  }
}

// A list of pairs rather than a free-form object: some providers refuse a tool
// parameter that declares no property.
const customFieldEntriesSchema = z
  .array(
    z.object({
      field: z
        .string()
        .describe("The custom field's label as shown on the customer record, or its key"),
      value: z
        .string()
        .describe(
          'The value. Checkboxes take "true" or "false", dates YYYY-MM-DD. An empty string clears the field.',
        ),
    }),
  )
  .optional()
  .describe(
    "Custom fields defined by the store (ID numbers, licence, sizes…). An unknown field name returns the list of available fields.",
  );

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createAITools(ctx: AIChatContext) {
  /** The settings a recorded payment's currency and insurance share are read with. */
  const loadStoreSettings = async () => {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, ctx.storeId),
      columns: { settings: true },
    });
    return store?.settings ?? null;
  };

  return {
    // ── Products ──────────────────────────────────────────────────────────

    list_products: tool({
      description: "List products in the store catalog with optional filters",
      inputSchema: z.object({
        status: z
          .enum(["active", "draft", "archived", "all"])
          .optional()
          .describe("Filter by status"),
        categoryId: z.string().optional().describe("Filter by category ID"),
        search: z.string().optional().describe("Search by product name"),
      }),
      execute: async ({ status, categoryId, search }) => {
        const page = await assistantApi(ctx).products.list({
          status,
          categoryIds: categoryId ? [categoryId] : undefined,
          search,
          limit: 50,
        });
        return {
          products: page.items.map((product) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            deposit: product.deposit,
            pricingKind: product.pricingKind,
            pricingMode: product.pricingMode,
            stockKind: product.stockKind,
            quantity: product.stockKind === "untracked" ? null : product.quantity,
            status: product.status,
            categoryName: product.category?.name ?? null,
          })),
          total: status && status !== "all" ? page.counts[status] : page.counts.all,
          currency: page.currency,
        };
      },
    }),

    get_product: tool({
      description:
        "Get detailed information about a specific product: pricing and tiers, stock and units, accessories",
      inputSchema: z.object({
        productId: z.string().describe("The product ID"),
      }),
      execute: async ({ productId }) => {
        const product = await assistantApi(ctx).products.get({ id: productId });
        return {
          product: {
            ...product,
            quantity: product.stockKind === "untracked" ? null : product.quantity,
          },
        };
      },
    }),

    create_product: tool({
      description:
        "Create a new product in the catalog. A duration product is priced per base period; tiers are the total price for a longer duration.",
      inputSchema: z.object({
        name: z.string().min(2).describe("Product name"),
        description: z.string().optional().describe("Product description"),
        price: z.string().describe('Price per period, or the fixed price (e.g. "25.00")'),
        deposit: z.string().optional().describe('Deposit amount (e.g. "100.00")'),
        pricingKind: z
          .enum(["duration", "fixed"])
          .optional()
          .describe("duration (default): priced per period; fixed: one price per item"),
        pricingMode: z.enum(["hour", "day", "week"]).optional().describe("Pricing period"),
        rateTiers: z
          .array(
            z.object({
              duration: z.number().int().min(1),
              unit: z.enum(["hour", "day", "week"]),
              price: z.string().describe("Total price for exactly this duration"),
            }),
          )
          .optional()
          .describe("Degressive rates of a duration product"),
        quantity: z.number().int().min(0).optional().describe("Stock quantity (default 1)"),
        categoryId: z.string().optional().describe("Category ID"),
      }),
      execute: async ({ categoryId, ...input }) => {
        const product = await assistantApi(ctx).products.create({
          ...input,
          categoryIds: categoryId ? [categoryId] : undefined,
        });
        return {
          id: product.id,
          name: product.name,
          price: product.price,
          pricingKind: product.pricingKind,
          pricingMode: product.pricingMode,
          quantity: product.quantity,
        };
      },
    }),

    update_product: tool({
      description:
        "Update an existing product. Send only the fields to change; price alone changes a duration product's base price.",
      inputSchema: z.object({
        productId: z.string().describe("The product ID to update"),
        name: z.string().optional().describe("New product name"),
        description: z.string().optional().describe("New description"),
        price: z.string().optional().describe("New price"),
        deposit: z.string().optional().describe("New deposit amount"),
        quantity: z.number().int().optional().describe("New stock quantity"),
        status: z.enum(["active", "draft", "archived"]).optional().describe("New status"),
      }),
      execute: async ({ productId, ...updates }) => {
        if (Object.values(updates).every((value) => value === undefined)) {
          return { error: "No fields to update" };
        }
        await assistantApi(ctx).products.update({ id: productId, ...updates });
        return { success: true, productId };
      },
    }),

    archive_product: tool({
      description:
        "Archive a product (soft delete): it leaves the storefront and the catalog; its reservations are kept",
      inputSchema: z.object({
        productId: z.string().describe("The product ID to archive"),
      }),
      execute: async ({ productId }) => {
        const product = await assistantApi(ctx).products.get({ id: productId });
        await assistantApi(ctx).products.updateStatus({ id: productId, status: "archived" });
        return { success: true, name: product.name };
      },
    }),

    // ── Reservations ─────────────────────────────────────────────────────

    list_reservations: tool({
      description:
        "List reservations as the dashboard's list does: by status, by period (today, this week, this month, on the start date) or by number or customer name",
      inputSchema: z.object({
        status: z
          .enum(["pending", "confirmed", "ongoing", "completed", "cancelled", "rejected"])
          .optional(),
        period: z.enum(["today", "week", "month"]).optional(),
        search: z.string().optional().describe("Search by reservation number or customer name"),
      }),
      execute: async ({ status, period, search }) => {
        const page = await assistantApi(ctx).reservations.list({
          status,
          period,
          search,
          limit: 50,
        });
        return {
          reservations: page.items.map((reservation) => ({
            id: reservation.id,
            number: reservation.number,
            status: reservation.status,
            startDate: reservation.startDate,
            endDate: reservation.endDate,
            totalAmount: reservation.totalAmount,
            customerFirstName: reservation.customer?.firstName ?? null,
            customerLastName: reservation.customer?.lastName ?? null,
          })),
          total: page.totalCount,
          currency: page.currency,
        };
      },
    }),

    get_reservation: tool({
      description: "Get complete details of a specific reservation",
      inputSchema: z.object({
        reservationId: z.string().describe("The reservation ID"),
      }),
      execute: async ({ reservationId }) => ({
        reservation: await assistantApi(ctx).reservations.get({ id: reservationId }),
      }),
    }),

    update_reservation_status: tool({
      description:
        "Change the status of a reservation: confirm, reject, cancel, mark as picked up (ongoing) or returned (completed). Like the dashboard, it also emails the customer when a request is confirmed or rejected, notifies the store, and, when the store uses insurance, creates the contract on a confirmation and cancels it on a cancellation.",
      inputSchema: z.object({
        reservationId: z.string().describe("The reservation ID"),
        status: z
          .enum(["confirmed", "ongoing", "completed", "cancelled", "rejected"])
          .describe("New status"),
      }),
      // As on the dashboard: the stock check, the fees, the insurance contract,
      // the emails and the notifications.
      execute: async ({ reservationId, status }) => {
        const change = await assistantApi(ctx).reservations.updateStatus({
          id: reservationId,
          status,
        });
        return {
          success: true,
          number: change.number,
          from: change.from,
          to: change.to,
          // What the dashboard shows after the change: rule warnings, a failed contract.
          ...(change.warnings.length > 0 && { warnings: change.warnings }),
        };
      },
    }),

    update_reservation_notes: tool({
      description: "Update internal notes on a reservation",
      inputSchema: z.object({
        reservationId: z.string().describe("The reservation ID"),
        notes: z.string().describe("The new internal notes content"),
      }),
      execute: async ({ reservationId, notes }) => {
        const updated = await assistantApi(ctx).reservations.updateNotes({
          id: reservationId,
          notes,
        });
        return { success: true, number: updated.number };
      },
    }),

    get_reservation_counters: tool({
      description: "Get quick reservation counters by status (pending, ongoing, etc.)",
      inputSchema: z.object({}),
      execute: async () => {
        const poll = await assistantApi(ctx).reservations.poll({});
        return { counts: poll.counts, pending: poll.pendingCount, total: poll.totalCount };
      },
    }),

    // ── Customers ─────────────────────────────────────────────────────────

    list_customers: tool({
      description: "List customers with optional search, type filter, and date filter",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe(
            "Search by name, email, or the start of a searchable custom field (an ID or licence number)",
          ),
        type: z.enum(["individual", "business"]).optional(),
        since: z
          .string()
          .optional()
          .describe("Only customers created after this date (YYYY-MM-DD)"),
      }),
      execute: async ({ search, type, since }) => {
        requirePermission(ctx, "customers", "read");

        const conditions = [eq(customers.storeId, ctx.storeId)];
        if (type) {
          // Business: default identity or at least one reservation billed to a company.
          const isBusiness = or(
            eq(customers.customerType, "business"),
            exists(
              db
                .select({ id: reservations.id })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.customerId, customers.id),
                    sql`JSON_UNQUOTE(JSON_EXTRACT(${reservations.billingSnapshot}, '$.customerType')) = 'business'`,
                  ),
                ),
            ),
          );
          if (isBusiness) {
            conditions.push(type === "business" ? isBusiness : sql`NOT (${isBusiness})`);
          }
        }
        if (since) conditions.push(gte(customers.createdAt, new Date(since)));
        if (search) {
          const s = `%${search.toLowerCase()}%`;
          const nativeMatch = sql`(LOWER(${customers.firstName}) LIKE ${s} OR LOWER(${customers.lastName}) LIKE ${s} OR LOWER(${customers.email}) LIKE ${s})`;
          const customMatch = customerFieldSearchCondition(ctx.storeId, search);
          conditions.push(customMatch ? sql`(${nativeMatch} OR ${customMatch})` : nativeMatch);
        }

        const rows = await db
          .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            customerType: customers.customerType,
            companyName: customers.companyName,
            createdAt: customers.createdAt,
          })
          .from(customers)
          .where(and(...conditions))
          .orderBy(desc(customers.createdAt))
          .limit(50);

        const [countResult] = await db
          .select({ total: sql<number>`COUNT(*)` })
          .from(customers)
          .where(and(...conditions));

        return { customers: rows, total: countResult?.total ?? 0 };
      },
    }),

    get_customer: tool({
      description:
        "Get detailed customer profile with reservation history and the store's custom fields. Custom fields the store flagged as sensitive are never returned: their labels come back in `withheldSensitiveFields`, which means the value exists on the record and can be read by the merchant in the dashboard, not that it is missing.",
      inputSchema: z.object({
        customerId: z.string().describe("The customer ID"),
      }),
      execute: async ({ customerId }) => {
        requirePermission(ctx, "customers", "read");

        const customer = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
          with: {
            reservations: {
              orderBy: [desc(reservations.createdAt)],
              limit: 10,
            },
          },
        });

        if (!customer) return { error: "Customer not found" };

        const [definitions, values] = await Promise.all([
          listCustomerFieldDefinitions(ctx.storeId, { activeOnly: true, scope: "customer" }),
          getCustomerFieldValues(ctx.storeId, customer.id),
        ]);
        const { fields, withheld } = toReadableCustomerFields(definitions, values);

        return { customer, customFields: fields, withheldSensitiveFields: withheld };
      },
    }),

    create_customer: tool({
      description: "Create a new customer",
      inputSchema: z.object({
        email: z.email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional(),
        customerType: z.enum(["individual", "business"]).optional(),
        companyName: z.string().optional(),
        customFields: customFieldEntriesSchema,
      }),
      execute: async ({
        email,
        firstName,
        lastName,
        phone,
        customerType,
        companyName,
        customFields,
      }) => {
        requirePermission(ctx, "customers", "write");

        const existing = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.email, email)),
          columns: { id: true },
        });
        if (existing) return { error: "A customer with this email already exists" };

        const definitions = await listCustomerFieldDefinitions(ctx.storeId, {
          activeOnly: true,
          scope: "customer",
        });
        const checked = checkCustomerFieldEntries({
          definitions,
          entries: customFields,
          customerType: customerType ?? "individual",
          partial: false,
        });
        if (!checked.ok) return { error: checked.error };

        const createdId = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(customers)
            .values({
              storeId: ctx.storeId,
              email,
              firstName,
              lastName,
              phone: phone ?? null,
              customerType: customerType ?? "individual",
              companyName: companyName ?? null,
              createdVia: "ai",
            })
            .$returningId();

          await saveCustomerFieldValues(tx, {
            storeId: ctx.storeId,
            customerId: created.id,
            values: checked.values,
            definitions,
          });
          return created.id;
        });

        return { id: createdId, firstName, lastName, email };
      },
    }),

    update_customer: tool({
      description: "Update an existing customer",
      inputSchema: z.object({
        customerId: z.string().describe("The customer ID"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        postalCode: z.string().optional(),
        notes: z.string().optional(),
        customFields: customFieldEntriesSchema,
      }),
      execute: async ({ customerId, customFields, ...updates }) => {
        requirePermission(ctx, "customers", "write");

        const existing = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
          columns: { id: true, email: true, customerType: true },
        });
        if (!existing) return { error: "Customer not found" };

        if (updates.email && updates.email !== existing.email) {
          const emailTaken = await db.query.customers.findFirst({
            where: and(eq(customers.storeId, ctx.storeId), eq(customers.email, updates.email)),
            columns: { id: true },
          });
          if (emailTaken) return { error: "A customer with this email already exists" };
        }

        const updateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateData[key] = value;
        }

        const hasCustomFields = (customFields?.length ?? 0) > 0;
        if (Object.keys(updateData).length === 0 && !hasCustomFields) {
          return { error: "No fields to update" };
        }

        const definitions = await listCustomerFieldDefinitions(ctx.storeId, {
          activeOnly: true,
          scope: "customer",
        });
        const checked = checkCustomerFieldEntries({
          definitions,
          entries: customFields,
          customerType: existing.customerType,
          partial: true,
        });
        if (!checked.ok) return { error: checked.error };

        await db.transaction(async (tx) => {
          if (Object.keys(updateData).length > 0) {
            await tx
              .update(customers)
              .set(updateData)
              .where(and(eq(customers.id, customerId), eq(customers.storeId, ctx.storeId)));
          }
          await saveCustomerFieldValues(tx, {
            storeId: ctx.storeId,
            customerId,
            values: checked.values,
            definitions,
          });
        });
        return { success: true, customerId };
      },
    }),

    // ── Payments ──────────────────────────────────────────────────────────

    list_payments: tool({
      description: "List all payments for a specific reservation",
      inputSchema: z.object({
        reservationId: z.string().describe("The reservation ID"),
      }),
      execute: async ({ reservationId }) => {
        requirePermission(ctx, "payments", "read");

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true },
        });
        if (!reservation) return { error: "Reservation not found" };

        const rows = await db.query.payments.findMany({
          where: eq(payments.reservationId, reservationId),
          orderBy: [payments.createdAt],
        });

        return { payments: rows, reservationNumber: reservation.number };
      },
    }),

    record_payment: tool({
      description: "Record a manual payment for a reservation",
      inputSchema: z.object({
        reservationId: z.string(),
        type: z.enum(["rental", "deposit", "deposit_return", "damage", "adjustment"]),
        amount: z.string().describe('Amount (e.g. "150.00")'),
        method: z.enum(["cash", "card", "transfer", "check", "other"]),
        notes: z.string().optional(),
      }),
      execute: async ({ reservationId, type, amount, method, notes }) => {
        requirePermission(ctx, "payments", "write");

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount === 0) {
          return { error: "Amount must be a non-zero number" };
        }

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true, status: true },
        });
        if (!reservation) return { error: "Reservation not found" };

        if (reservation.status === "cancelled" || reservation.status === "rejected") {
          return {
            error: `Cannot record payment on a ${reservation.status} reservation`,
          };
        }

        // The dashboard's writer: billing facts, currency and the reservation's mark.
        const storeSettings = await loadStoreSettings();
        await db.transaction((tx) =>
          insertRecordedPayment(tx, {
            id: nanoid(),
            reservationId,
            storeId: ctx.storeId,
            storeSettings,
            amount,
            type,
            method,
            origin: "manual",
            paidAt: new Date(),
            notes: notes ?? null,
          }),
        );

        return {
          success: true,
          reservationNumber: reservation.number,
          type,
          amount,
          method,
        };
      },
    }),

    delete_payment: tool({
      description: "Delete a manual payment record (cannot delete Stripe payments)",
      inputSchema: z.object({
        paymentId: z.string().describe("The payment ID to delete"),
      }),
      execute: async ({ paymentId }) => {
        requirePermission(ctx, "payments", "write");

        const payment = await db.query.payments.findFirst({
          where: eq(payments.id, paymentId),
          with: { reservation: { columns: { storeId: true, number: true } } },
        });

        if (!payment || payment.reservation?.storeId !== ctx.storeId) {
          return { error: "Payment not found" };
        }

        if (payment.method === "stripe") {
          return {
            error: "Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.",
          };
        }

        await deleteRecordedPayment(db, {
          paymentId,
          reservationId: payment.reservationId,
          storeId: ctx.storeId,
        });
        return {
          success: true,
          reservationNumber: payment.reservation?.number,
        };
      },
    }),

    return_deposit: tool({
      description: "Record a deposit return for a reservation (validates max returnable amount)",
      inputSchema: z.object({
        reservationId: z.string().describe("The reservation ID"),
        amount: z.string().describe('Amount to return (e.g. "100.00")'),
        method: z.enum(["cash", "card", "transfer", "check", "other"]).describe("Return method"),
        notes: z.string().optional(),
      }),
      execute: async ({ reservationId, amount, method, notes }) => {
        requirePermission(ctx, "payments", "write");

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
          return { error: "Amount must be greater than zero" };
        }

        const reservation = await db.query.reservations.findFirst({
          where: and(eq(reservations.storeId, ctx.storeId), eq(reservations.id, reservationId)),
          columns: { id: true, number: true },
          with: { payments: true },
        });
        if (!reservation) return { error: "Reservation not found" };

        const depositCollected = reservation.payments
          .filter((p) => p.type === "deposit" && p.status === "completed")
          .reduce((s, p) => s + parseFloat(p.amount), 0);
        const depositReturned = reservation.payments
          .filter((p) => p.type === "deposit_return" && p.status === "completed")
          .reduce((s, p) => s + parseFloat(p.amount), 0);
        const maxReturnable = depositCollected - depositReturned;

        if (numAmount > maxReturnable) {
          return {
            error: `Amount exceeds returnable deposit. Collected: ${depositCollected.toFixed(2)}, already returned: ${depositReturned.toFixed(2)}, max returnable: ${maxReturnable.toFixed(2)}`,
          };
        }

        const storeSettings = await loadStoreSettings();
        await db.transaction((tx) =>
          insertRecordedPayment(tx, {
            id: nanoid(),
            reservationId,
            storeId: ctx.storeId,
            storeSettings,
            amount,
            type: "deposit_return",
            method,
            origin: "deposit",
            paidAt: new Date(),
            notes: notes ?? null,
          }),
        );

        return {
          success: true,
          reservationNumber: reservation.number,
          amount,
          method,
        };
      },
    }),

    // ── Analytics ─────────────────────────────────────────────────────────

    get_dashboard_stats: tool({
      description: "Get key dashboard metrics (revenue, reservations, visitors) for a given period",
      inputSchema: z.object({
        period: z
          .enum(["7d", "30d", "90d", "12m"])
          .optional()
          .describe("Time period (default 30d)"),
      }),
      execute: async ({ period }) => {
        requirePermission(ctx, "analytics", "read");

        const end = new Date();
        const start = new Date();
        switch (period ?? "30d") {
          case "7d":
            start.setDate(start.getDate() - 7);
            break;
          case "30d":
            start.setDate(start.getDate() - 30);
            break;
          case "90d":
            start.setDate(start.getDate() - 90);
            break;
          case "12m":
            start.setMonth(start.getMonth() - 12);
            break;
        }

        const stats = await db
          .select({
            totalRevenue: sum(dailyStats.revenue),
            totalReservationsCreated: sum(dailyStats.reservationsCreated),
            totalReservationsConfirmed: sum(dailyStats.reservationsConfirmed),
            totalVisitors: sum(dailyStats.uniqueVisitors),
            totalPageViews: sum(dailyStats.pageViews),
          })
          .from(dailyStats)
          .where(
            and(
              eq(dailyStats.storeId, ctx.storeId),
              gte(dailyStats.date, start),
              lte(dailyStats.date, end),
            ),
          );

        const [activeCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(reservations)
          .where(
            and(
              eq(reservations.storeId, ctx.storeId),
              sql`${reservations.status} IN ('pending', 'confirmed', 'ongoing')`,
            ),
          );

        return {
          period: period ?? "30d",
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...stats[0],
          activeReservations: activeCount?.count ?? 0,
        };
      },
    }),

    get_product_performance: tool({
      description: "Get top-performing products by revenue",
      inputSchema: z.object({
        period: z.enum(["7d", "30d", "90d", "12m"]).optional(),
        limit: z.number().optional().describe("Number of products (default 10)"),
      }),
      execute: async ({ period, limit: maxResults }) => {
        requirePermission(ctx, "analytics", "read");

        const end = new Date();
        const start = new Date();
        switch (period ?? "30d") {
          case "7d":
            start.setDate(start.getDate() - 7);
            break;
          case "30d":
            start.setDate(start.getDate() - 30);
            break;
          case "90d":
            start.setDate(start.getDate() - 90);
            break;
          case "12m":
            start.setMonth(start.getMonth() - 12);
            break;
        }
        const lim = Math.min(maxResults ?? 10, 50);

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
              lte(productStats.date, end),
            ),
          )
          .groupBy(productStats.productId, products.name)
          .orderBy(desc(sum(productStats.revenue)))
          .limit(lim);

        return { products: rows, period: period ?? "30d" };
      },
    }),

    get_revenue_report: tool({
      description: "Get a day-by-day revenue breakdown over a custom date range",
      inputSchema: z.object({
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
      }),
      execute: async ({ startDate, endDate }) => {
        requirePermission(ctx, "analytics", "read");

        const start = new Date(startDate);
        const end = new Date(endDate);

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
              lte(dailyStats.date, end),
            ),
          )
          .orderBy(dailyStats.date);

        const totalRevenue = rows.reduce((acc, r) => acc + parseFloat(r.revenue ?? "0"), 0);
        const totalReservations = rows.reduce((acc, r) => acc + (r.reservationsCreated ?? 0), 0);

        return {
          startDate,
          endDate,
          totalRevenue: totalRevenue.toFixed(2),
          totalReservations,
          daysWithData: rows.length,
          daily: rows,
        };
      },
    }),

    // ── Calendar ──────────────────────────────────────────────────────────

    calendar_upcoming: tool({
      description:
        "Get upcoming pickups and returns, starting from the beginning of today. Use days=1 for today only.",
      inputSchema: z.object({
        days: z
          .number()
          .optional()
          .describe("Number of days to cover, counted from today (default 7). 1 = today only."),
      }),
      execute: async ({ days }) => {
        const lookAhead = Math.min(Math.max(Math.round(days ?? 7), 1), 90);
        const agenda = await assistantApi(ctx).reservations.listUpcoming({ days: lookAhead });
        const row = (entry: (typeof agenda.pickups)[number], date: Date) => ({
          id: entry.id,
          number: entry.number,
          date,
          customerFirstName: entry.customer?.firstName ?? null,
          customerLastName: entry.customer?.lastName ?? null,
          totalAmount: entry.totalAmount,
        });
        return {
          pickups: agenda.pickups.map((entry) => row(entry, entry.startDate)),
          returns: agenda.returns.map((entry) => row(entry, entry.endDate)),
          days: lookAhead,
        };
      },
    }),

    calendar_overdue: tool({
      description: "Get overdue returns (ongoing reservations past their end date)",
      inputSchema: z.object({}),
      execute: async () => {
        const { items } = await assistantApi(ctx).reservations.listOverdue({});
        return {
          overdue: items.map((entry) => ({
            id: entry.id,
            number: entry.number,
            endDate: entry.endDate,
            daysLate: entry.daysLate,
            customerFirstName: entry.customer?.firstName ?? null,
            customerLastName: entry.customer?.lastName ?? null,
            totalAmount: entry.totalAmount,
          })),
        };
      },
    }),

    check_availability: tool({
      description: "Check product availability for a date range",
      inputSchema: z.object({
        productId: z.string(),
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
      }),
      execute: async ({ productId, startDate, endDate }) => {
        requirePermission(ctx, "products", "read");

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
        if (!product) return { error: "Product not found" };

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

        return {
          product: product.name,
          totalStock: capacity,
          reserved: capacity === null ? null : reserved,
          available,
          turnoverBufferMinutes,
          startDate,
          endDate,
        };
      },
    }),

    // ── Categories ────────────────────────────────────────────────────────

    // The categories procedures themselves, as the signed-in user: the same
    // rights and rules as the dashboard, the API and MCP.
    list_categories: tool({
      description: "List all product categories, with how many products each holds",
      inputSchema: z.object({}),
      execute: async () => {
        const items = [];
        let cursor: string | undefined;
        do {
          const page = await assistantApi(ctx).categories.list({ cursor });
          items.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return {
          categories: items.map((category) => ({
            id: category.id,
            name: category.name,
            description: category.description,
            productCount: category.productCount,
          })),
        };
      },
    }),

    create_category: tool({
      description:
        "Create a new product category; an existing category with the same name is returned instead",
      inputSchema: z.object({
        name: z.string().min(2),
        description: z.string().optional(),
      }),
      execute: async ({ name, description }) => {
        const category = await assistantApi(ctx).categories.create({ name, description });
        return { id: category.id, name: category.name, created: category.created };
      },
    }),

    update_category: tool({
      description: "Update an existing product category",
      inputSchema: z.object({
        categoryId: z.string().describe("The category ID"),
        name: z.string().min(2).optional().describe("New name"),
        description: z.string().optional().describe("New description"),
      }),
      execute: async ({ categoryId, name, description }) => {
        if (name === undefined && description === undefined) {
          return { error: "No fields to update" };
        }
        await assistantApi(ctx).categories.update({ id: categoryId, name, description });
        return { success: true, categoryId };
      },
    }),

    delete_category: tool({
      description:
        "Delete a product category; its products keep their other categories, or have none left",
      inputSchema: z.object({
        categoryId: z.string().describe("The category ID to delete"),
      }),
      execute: async ({ categoryId }) => {
        const deleted = await assistantApi(ctx).categories.delete({ id: categoryId });
        return { success: true, affectedProductCount: deleted.affectedProductCount };
      },
    }),

    // ── Settings ──────────────────────────────────────────────────────────

    get_store_settings: tool({
      description: "Get complete store configuration (name, contact, settings)",
      inputSchema: z.object({}),
      execute: async () => {
        requirePermission(ctx, "settings", "read");

        const store = await db.query.stores.findFirst({
          where: eq(stores.id, ctx.storeId),
        });

        if (!store) return { error: "Store not found" };
        return {
          name: store.name,
          slug: store.slug,
          email: store.email,
          phone: store.phone,
          address: store.address,
          description: store.description,
          settings: store.settings,
          theme: store.theme,
          emailSettings: store.emailSettings,
          stripeConnected: !!store.stripeOnboardingComplete,
        };
      },
    }),

    update_store_info: tool({
      description: "Update store contact information",
      inputSchema: z.object({
        name: z.string().optional(),
        email: z.email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async (updates) => {
        requirePermission(ctx, "settings", "write");

        const updateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateData[key] = value;
        }

        if (Object.keys(updateData).length === 0) {
          return { error: "No fields to update" };
        }

        await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId));
        return { success: true };
      },
    }),
  };
}
