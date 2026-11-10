import { tool } from "ai";
import { and, desc, eq, exists, gte, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  customers,
  db,
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  getBlockingReservationStatuses,
  loadConsumableReservedQuantities,
  payments,
  productUnits,
  products,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";
import type { AppRouter, UrlsPort } from "@louez/api";
import { ANALYTICS_PERIODS } from "@louez/api/contracts/analytics";
import { customerLinks, reservationLinks } from "@louez/api/platform/links";
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
   * The deployment's addresses, the API's `ports.urls`: the links the tools
   * return are the ones agents get, and the chat opens them inside the app.
   */
  urls: UrlsPort;
  /**
   * The agent-ready procedures, called as the signed-in user (their session,
   * their current role), like the dashboard calls them. Domains move here as
   * they migrate (docs/architecture/api-and-agents.md).
   */
  api?: AssistantApi;
};

/** The procedures the assistant calls, through a server-side client bound to the user's session. */
export type AssistantApi = {
  analytics: RouterClient<AppRouter["dashboard"]["analytics"]>;
  categories: RouterClient<AppRouter["dashboard"]["categories"]>;
  products: RouterClient<AppRouter["dashboard"]["products"]>;
  reservations: RouterClient<AppRouter["dashboard"]["reservations"]>;
  settings: RouterClient<AppRouter["dashboard"]["settings"]>;
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

/** Whether the chat's user may read a domain: a link names a record of it. */
const mayRead = (ctx: AIChatContext, domain: keyof ApiKeyPermissions) =>
  ctx.permissions[domain] !== "none";

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
  /** The chat's store, named by every dashboard link the tools return. */
  const linkStore = { id: ctx.storeId };
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
            links: product.links,
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
          links: product.links,
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
        const product = await assistantApi(ctx).products.update({ id: productId, ...updates });
        return { success: true, productId, links: product.links };
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
        const archived = await assistantApi(ctx).products.updateStatus({
          id: productId,
          status: "archived",
        });
        return { success: true, name: product.name, links: archived.links };
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
            links: reservation.links,
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
      // The procedure's answer as it is: its links, and the customer only for
      // a user who may read customers.
      execute: async ({ reservationId }) => ({
        reservation: await assistantApi(ctx).reservations.get({ id: reservationId }),
      }),
    }),

    update_reservation_status: tool({
      description:
        "Change the status of a reservation: confirm, reject, cancel, mark as picked up (ongoing) or returned (completed). Like the dashboard, it also tells the customer when a request is confirmed or rejected and when the store cancels, as the store's customer notification settings say, notifies the store, and, when the store uses insurance, creates the contract on a confirmation and cancels it on a cancellation.",
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
          links: change.links,
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
        return { success: true, number: updated.number, links: updated.links };
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

        return {
          customers: rows.map((row) => ({
            ...row,
            links: customerLinks(ctx.urls, linkStore, row),
          })),
          total: countResult?.total ?? 0,
        };
      },
    }),

    get_customer: tool({
      description:
        "Get detailed customer profile with the store's custom fields, and the reservation history when the user may read reservations. Custom fields the store flagged as sensitive are never returned: their labels come back in `withheldSensitiveFields`, which means the value exists on the record and can be read by the merchant in the dashboard, not that it is missing.",
      inputSchema: z.object({
        customerId: z.string().describe("The customer ID"),
      }),
      execute: async ({ customerId }) => {
        requirePermission(ctx, "customers", "read");

        const customer = await db.query.customers.findFirst({
          where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
          columns: {
            id: true,
            customerType: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            companyName: true,
            companyNumber: true,
            vatNumber: true,
            address: true,
            city: true,
            postalCode: true,
            country: true,
            notes: true,
            createdAt: true,
          },
        });

        if (!customer) return { error: "Customer not found" };

        const [definitions, values] = await Promise.all([
          listCustomerFieldDefinitions(ctx.storeId, { activeOnly: true, scope: "customer" }),
          getCustomerFieldValues(ctx.storeId, customer.id),
        ]);
        const { fields, withheld } = toReadableCustomerFields(definitions, values);

        // The history is reservation data (ids, numbers, amounts): only for
        // a user who may read reservations, each with its link.
        const history = mayRead(ctx, "reservations")
          ? (
              await db
                .select({
                  id: reservations.id,
                  number: reservations.number,
                  status: reservations.status,
                  startDate: reservations.startDate,
                  endDate: reservations.endDate,
                  totalAmount: reservations.totalAmount,
                })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.storeId, ctx.storeId),
                    eq(reservations.customerId, customer.id),
                  ),
                )
                .orderBy(desc(reservations.createdAt))
                .limit(10)
            ).map((reservation) => ({
              ...reservation,
              links: reservationLinks(ctx.urls, linkStore, reservation),
            }))
          : undefined;

        return {
          customer: {
            ...customer,
            links: customerLinks(ctx.urls, linkStore, customer),
            ...(history ? { reservations: history } : {}),
          },
          customFields: fields,
          withheldSensitiveFields: withheld,
        };
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

        return {
          id: createdId,
          firstName,
          lastName,
          email,
          links: customerLinks(ctx.urls, linkStore, { id: createdId }),
        };
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
        return {
          success: true,
          customerId,
          links: customerLinks(ctx.urls, linkStore, { id: customerId }),
        };
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
      description:
        "Get the figures of the dashboard home, live: today's revenue, departures and returns; the revenue this month, last month and since the store opened; the reservations by status; the products and customers. Revenue is the rental payments received (every method), on the day they were cashed in, in the store's time zone and currency. Payments in another currency are left out of the amounts and listed in otherCurrencies.",
      inputSchema: z.object({}),
      execute: async () => assistantApi(ctx).analytics.getDashboardStats({}),
    }),

    get_product_performance: tool({
      description:
        "Rank the products by their share of the rental payments received over a period, as the sales page's top products table does, with the units booked and the reservations behind it. Payments in another currency than the store's are left out and listed in otherCurrencies.",
      inputSchema: z.object({
        period: z
          .enum(ANALYTICS_PERIODS)
          .optional()
          .describe("Rolling period ending now (default 30d)"),
        limit: z.number().optional().describe("Number of products (default 10, at most 50)"),
      }),
      execute: async ({ period, limit }) =>
        assistantApi(ctx).analytics.getProductPerformance({
          period,
          limit: limit === undefined ? undefined : Math.min(Math.max(Math.trunc(limit), 1), 50),
        }),
    }),

    get_revenue_report: tool({
      description:
        "Get the revenue over a custom date range, as the sales page counts it: rental payments received, every method, on the day they were cashed in, per day (per month past 92 days), by payment method, plus the reservations that start in the range. Payments in another currency than the store's are left out and listed in otherCurrencies.",
      inputSchema: z.object({
        startDate: z.string().describe("Start date (YYYY-MM-DD), in the store's time zone"),
        endDate: z.string().describe("End date (YYYY-MM-DD), included"),
      }),
      execute: async ({ startDate, endDate }) =>
        assistantApi(ctx).analytics.getRevenueReport({ startDate, endDate }),
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
          links: entry.links,
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
            links: entry.links,
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
      description:
        "Get the store's whole configuration: info and contact, company, legal texts, reservation rules, business hours, delivery and pickup points, taxes, with the link to its settings",
      inputSchema: z.object({}),
      execute: async () => assistantApi(ctx).settings.get({}),
    }),

    update_store_info: tool({
      description:
        "Update the store's name, description and contact details; send only the fields to change, null clears one",
      inputSchema: z.object({
        name: z.string().optional(),
        email: z.email().nullable().optional(),
        phone: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      }),
      execute: async (updates) => assistantApi(ctx).settings.updateStoreInfo(updates),
    }),
  };
}
