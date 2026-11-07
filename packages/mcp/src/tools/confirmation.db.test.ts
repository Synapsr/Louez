import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { McpStatusChangeInput } from "../deps";
import type { McpRecordedPayment } from "./payments";

// The hand-written tools that move money, delete or send to a customer ask for
// a confirmation first, as sensitive procedures do, when the connection wants
// one: the first call does nothing and answers CONFIRMATION_REQUIRED with a
// preview and a token; the same call with the token runs once.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_mcp_confirm";
const USER = "user_mcp_confirm";
const PRODUCT = "prod_mcp_confirm_001";
const permissions = {
  reservations: "write",
  products: "write",
  customers: "read",
  categories: "read",
  payments: "write",
  analytics: "read",
  settings: "read",
} as const;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

describe(
  "confirmation of the sensitive hand-written tools (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let confirming: Client;
    let direct: Client;
    let statusChanges: McpStatusChangeInput[] = [];
    let recorded: McpRecordedPayment[] = [];
    let counter = 0;

    async function connect(confirmSensitive: boolean) {
      const { registerPaymentTools } = await import("./payments");
      const { registerProductTools } = await import("./products");
      const { registerReservationTools } = await import("./reservations");
      const { testRequestContext } = await import("../testing/reservation-tools-client");
      const ctx = testRequestContext({
        storeId: STORE,
        userId: USER,
        apiKeyId: confirmSensitive ? "key_confirming" : "key_direct",
        permissions,
        confirmSensitive,
      });
      const server = new McpServer({ name: "louez", version: "0.0.0" });
      registerReservationTools(server, ctx, {
        changeReservationStatus: async (input) => {
          statusChanges.push(input);
          return { ok: true, number: "R-1", from: "pending", to: input.to, warnings: [] };
        },
      });
      registerPaymentTools(server, ctx, {
        insertRecordedPayment: async (_tx, payment) => {
          recorded.push(payment);
        },
      });
      registerProductTools(server, ctx);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(clientTransport);
      return client;
    }

    before(async () => {
      database = await createTestDatabase("mcp_confirm");
      louezDb = await import("@louez/db");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Confirm store",
        slug: "mcp-confirm",
      });
      confirming = await connect(true);
      direct = await connect(false);
    });

    after(async () => {
      await confirming?.close();
      await direct?.close();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      statusChanges = [];
      recorded = [];
    });

    async function reservation(status: "pending" | "confirmed" = "pending") {
      const id = `res_mcp_confirm_${++counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer",
        number: id,
        status,
        startDate: new Date("2027-03-01T09:00:00Z"),
        endDate: new Date("2027-03-03T09:00:00Z"),
        subtotalAmount: "80.00",
        depositAmount: "50.00",
        totalAmount: "80.00",
      });
      return id;
    }

    const error = (result: ToolResult) =>
      (
        result.structuredContent as
          | { error?: { code?: string; details?: { confirmationToken?: string } } }
          | undefined
      )?.error;

    function confirmationToken(result: ToolResult): string {
      assert.equal(result.isError, true, JSON.stringify(result.content));
      assert.equal(error(result)?.code, "CONFIRMATION_REQUIRED");
      const token = error(result)?.details?.confirmationToken;
      assert.ok(token);
      return token;
    }

    test("a status change waits for the confirmation, then runs once", async () => {
      const id = await reservation();
      const args = { reservationId: id, status: "confirmed" };

      const first = await confirming.callTool({
        name: "update_reservation_status",
        arguments: args,
      });
      const token = confirmationToken(first);
      assert.match(JSON.stringify(first.content), new RegExp(`#${id}`), "the preview names it");
      assert.equal(statusChanges.length, 0, "nothing was done: no status change, no email");

      const second = await confirming.callTool({
        name: "update_reservation_status",
        arguments: { ...args, confirmationToken: token },
      });
      assert.notEqual(second.isError, true, JSON.stringify(second.content));
      assert.equal(statusChanges.length, 1);

      const replay = await confirming.callTool({
        name: "update_reservation_status",
        arguments: { ...args, confirmationToken: token },
      });
      assert.equal(error(replay)?.code, "CONFIRMATION_INVALID", "a token works once");
      assert.equal(statusChanges.length, 1);
    });

    test("a token stops working once the state it previewed changes", async () => {
      const id = await reservation();
      const args = { reservationId: id, type: "rental", amount: "80.00", method: "cash" };
      const token = confirmationToken(
        await confirming.callTool({ name: "record_payment", arguments: args }),
      );
      assert.equal(recorded.length, 0);

      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "confirmed" })
        .where(eq(louezDb.reservations.id, id));
      const late = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, confirmationToken: token },
      });
      assert.equal(error(late)?.code, "CONFIRMATION_INVALID");
      assert.equal(recorded.length, 0);

      // Another argument than the previewed one: refused too.
      const fresh = confirmationToken(
        await confirming.callTool({ name: "record_payment", arguments: args }),
      );
      const changed = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, amount: "800.00", confirmationToken: fresh },
      });
      assert.equal(error(changed)?.code, "CONFIRMATION_INVALID");
      assert.equal(recorded.length, 0);
    });

    test("archiving and deleting wait for the confirmation", async () => {
      await louezDb.db.insert(louezDb.products).values({
        id: PRODUCT,
        storeId: STORE,
        name: "Kayak",
        price: "40.00",
        pricingMode: "day",
      });
      const token = confirmationToken(
        await confirming.callTool({ name: "archive_product", arguments: { productId: PRODUCT } }),
      );
      const before = await louezDb.db.query.products.findFirst({
        where: eq(louezDb.products.id, PRODUCT),
        columns: { status: true },
      });
      assert.notEqual(before?.status, "archived");
      const archived = await confirming.callTool({
        name: "archive_product",
        arguments: { productId: PRODUCT, confirmationToken: token },
      });
      assert.notEqual(archived.isError, true, JSON.stringify(archived.content));
      const after = await louezDb.db.query.products.findFirst({
        where: eq(louezDb.products.id, PRODUCT),
        columns: { status: true },
      });
      assert.equal(after?.status, "archived");

      const id = await reservation("confirmed");
      const [payment] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId: id,
          amount: "20.00",
          type: "rental",
          method: "cash",
          status: "completed",
        })
        .$returningId();
      confirmationToken(
        await confirming.callTool({ name: "delete_payment", arguments: { paymentId: payment.id } }),
      );
      const kept = await louezDb.db.query.payments.findFirst({
        where: eq(louezDb.payments.id, payment.id),
      });
      assert.ok(kept, "the payment is still there");
    });

    test("update_product asks before archiving or deleting prices, not for a plain edit", async () => {
      const id = "prod_mcp_confirm_002";
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: "Canoe",
        price: "60.00",
        pricingMode: "day",
        status: "active",
      });
      await louezDb.db.insert(louezDb.productPricingTiers).values({
        productId: id,
        minDuration: 3,
        discountPercent: "10",
      });
      await louezDb.db.insert(louezDb.productSeasonalPricing).values({
        productId: id,
        name: "Summer",
        startDate: "2027-06-01",
        endDate: "2027-08-31",
        price: "80.00",
      });
      const product = () =>
        louezDb.db.query.products.findFirst({
          where: eq(louezDb.products.id, id),
          columns: { name: true, status: true, pricingKind: true },
        });
      const tiers = async () =>
        (
          await louezDb.db
            .select()
            .from(louezDb.productPricingTiers)
            .where(eq(louezDb.productPricingTiers.productId, id))
        ).length +
        (
          await louezDb.db
            .select()
            .from(louezDb.productSeasonalPricing)
            .where(eq(louezDb.productSeasonalPricing.productId, id))
        ).length;

      // A plain edit runs at once, even with confirmation on.
      const renamed = await confirming.callTool({
        name: "update_product",
        arguments: { productId: id, name: "Canoe XL" },
      });
      assert.notEqual(renamed.isError, true, JSON.stringify(renamed.content));
      assert.equal((await product())?.name, "Canoe XL");

      // Archiving waits.
      confirmationToken(
        await confirming.callTool({
          name: "update_product",
          arguments: { productId: id, status: "archived" },
        }),
      );
      assert.equal((await product())?.status, "active");

      // Fixed pricing would delete the tier and the seasonal price: it waits too.
      const args = { productId: id, pricingKind: "fixed" };
      const first = await confirming.callTool({ name: "update_product", arguments: args });
      const token = confirmationToken(first);
      assert.match(JSON.stringify(first.content), /1 pricing tier\(s\) and 1 seasonal price\(s\)/);
      assert.equal(await tiers(), 2);
      assert.equal((await product())?.pricingKind, "duration");

      const done = await confirming.callTool({
        name: "update_product",
        arguments: { ...args, confirmationToken: token },
      });
      assert.notEqual(done.isError, true, JSON.stringify(done.content));
      assert.equal(await tiers(), 0);
      assert.equal((await product())?.pricingKind, "fixed");

      // Fixed again, with nothing left to delete: a plain edit.
      const again = await confirming.callTool({ name: "update_product", arguments: args });
      assert.notEqual(again.isError, true, JSON.stringify(again.content));
    });

    test("a connection with confirmation off runs at once", async () => {
      const id = await reservation();
      const status = await direct.callTool({
        name: "update_reservation_status",
        arguments: { reservationId: id, status: "confirmed" },
      });
      assert.notEqual(status.isError, true, JSON.stringify(status.content));
      assert.equal(statusChanges.length, 1);

      const paid = await direct.callTool({
        name: "record_payment",
        arguments: { reservationId: id, type: "rental", amount: "80.00", method: "cash" },
      });
      assert.notEqual(paid.isError, true, JSON.stringify(paid.content));
      assert.equal(recorded.length, 1);
    });

    test("a record the preview cannot find goes to the tool, which answers for it", async () => {
      // No preview to show: the app's status change gets the call and answers
      // "not found" for a reservation outside the store (the stand-in here
      // answers ok); nothing is asked to be confirmed.
      const missing = await confirming.callTool({
        name: "update_reservation_status",
        arguments: { reservationId: "res_nowhere", status: "confirmed" },
      });
      assert.notEqual(error(missing)?.code, "CONFIRMATION_REQUIRED");
      assert.equal(statusChanges.length, 1);
      assert.equal(statusChanges[0]?.storeId, STORE, "scoped to the store, as the app checks");
    });
  },
);
