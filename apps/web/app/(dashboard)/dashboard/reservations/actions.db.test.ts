import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import { SENT_KEY, STORE_KEY } from "./actions-test-stubs";

// The dashboard's reservation actions on a migrated database: the payment rows
// they write, with their billing facts, and the reservation's mark for the billing
// service in the same transaction (louez-billing docs/api, README §5.2, Q3, Q4, Q7).
// The deposit actions call Stripe first; their writes are tested in
// lib/reservations/dashboard-payment-writes.db.test.ts.

const STORE = "store_actions";
const START = new Date("2026-04-10T09:00:00.000Z");
const END = new Date("2026-04-12T09:00:00.000Z");

describe("dashboard reservation actions (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("dashboard_reservation_actions");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");

    await louezDb.db.insert(louezDb.customers).values({
      id: "customer_actions",
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    // What getCurrentStore returns. No user id: analytics skips the event.
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      userId: "",
      name: "Actions",
      slug: "actions",
      settings: { currency: "usd" },
      stripeAccountId: null,
    });
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
  });

  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** 110.00 tax included, 10.00 of it insurance, with no currency of its own. */
  async function createReservation(options: { withItems?: boolean; currency?: string } = {}) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer_actions",
      number: id,
      status: "pending",
      startDate: START,
      endDate: END,
      subtotalAmount: "110.00",
      depositAmount: "50.00",
      totalAmount: "110.00",
      tulipInsuranceAmount: "10.00",
      source: "manual",
      ...(options.currency ? { currency: options.currency } : {}),
    });
    if (options.withItems) {
      await louezDb.db.insert(louezDb.reservationItems).values([
        {
          id: nextId("itm"),
          reservationId: id,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: "100.00",
          depositPerUnit: "50.00",
          totalPrice: "100.00",
          taxRate: "20.00",
          productSnapshot: { name: "Bike", description: null, images: [] },
        },
        {
          id: nextId("itm"),
          reservationId: id,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: "10.00",
          depositPerUnit: "0.00",
          totalPrice: "10.00",
          productSnapshot: { name: "Garantie casse/vol", description: null, images: [] },
        },
      ]);
    }
    return id;
  }

  async function readPayment(id: string) {
    const p = louezDb.payments;
    const [row] = await louezDb.db
      .select({
        amount: p.amount,
        type: p.type,
        method: p.method,
        status: p.status,
        currency: p.currency,
        grossMinor: p.grossMinor,
        insuranceShareMinor: p.insuranceShareMinor,
        origin: p.origin,
      })
      .from(p)
      .where(eq(p.id, id));
    return row;
  }

  async function countPayments(reservationId: string) {
    const rows = await louezDb.db
      .select({ id: louezDb.payments.id })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return rows.length;
  }

  async function readMarkVersion(reservationId: string): Promise<number | null> {
    const q = louezDb.billingSyncQueue;
    const [row] = await louezDb.db
      .select({ version: q.version, storeId: q.storeId, status: q.status })
      .from(q)
      .where(and(eq(q.aggregateType, "reservation"), eq(q.aggregateId, reservationId)));
    if (!row) return null;
    assert.equal(row.storeId, STORE);
    assert.equal(row.status, "pending");
    return row.version;
  }

  function paymentIdOf(result: { error?: string; paymentId?: string }): string {
    assert.equal(result.error, undefined);
    assert.ok(result.paymentId);
    return result.paymentId;
  }

  describe("recordPayment", () => {
    test("a rental payment carries its facts, in the store's currency, and marks the reservation", async () => {
      const reservationId = await createReservation({ withItems: true });

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "55",
          method: "cash",
        }),
      );

      assert.deepEqual(await readPayment(paymentId), {
        amount: "55.00",
        type: "rental",
        method: "cash",
        status: "completed",
        currency: "USD",
        grossMinor: 5500,
        insuranceShareMinor: 500,
        origin: "manual",
      });
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("a negative adjustment keeps its sign and carries no insurance", async () => {
      const reservationId = await createReservation();

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "adjustment",
          amount: "-10",
          method: "other",
        }),
      );

      const payment = await readPayment(paymentId);
      assert.equal(payment?.grossMinor, -1000);
      assert.equal(payment?.insuranceShareMinor, 0);
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("a refused payment writes nothing and marks nothing", async () => {
      const reservationId = await createReservation();

      assert.deepEqual(
        await actions.recordPayment(reservationId, { type: "rental", amount: "0", method: "cash" }),
        { error: "errors.invalidAmount" },
      );
      assert.equal(await countPayments(reservationId), 0);
      assert.equal(await readMarkVersion(reservationId), null);
    });

    test("without the billing service, the payment is recorded and nothing is marked", async () => {
      delete process.env.BILLING_SERVICE_URL;
      const reservationId = await createReservation();

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "deposit",
          amount: "50",
          method: "cash",
        }),
      );

      assert.equal((await readPayment(paymentId))?.grossMinor, 5000);
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });

  test("returnDeposit and recordDamage record their facts and mark the reservation", async () => {
    const reservationId = await createReservation();
    paymentIdOf(
      await actions.recordPayment(reservationId, { type: "deposit", amount: "50", method: "cash" }),
    );

    const returnId = paymentIdOf(
      await actions.returnDeposit(reservationId, { amount: "20", method: "cash" }),
    );
    const damageId = paymentIdOf(
      await actions.recordDamage(reservationId, { amount: "15", method: "card", notes: "scratch" }),
    );

    const returned = await readPayment(returnId);
    assert.equal(returned?.origin, "deposit");
    assert.equal(returned?.currency, "USD");
    assert.equal(returned?.grossMinor, 2000);
    const damage = await readPayment(damageId);
    assert.equal(damage?.origin, "manual");
    assert.equal(damage?.grossMinor, 1500);
    assert.equal(damage?.insuranceShareMinor, 0);
    assert.equal(await readMarkVersion(reservationId), 3);
  });

  describe("an amount in the reservation's currency, as the agents' writes judge it", () => {
    test("in yen, half a yen is refused by the three forms' writes and nothing is written; whole yen are recorded as the column holds them", async () => {
      const reservationId = await createReservation({ currency: "JPY" });
      paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "deposit",
          amount: "5",
          method: "cash",
        }),
      );
      const before = await countPayments(reservationId);

      const invalid = { error: "errors.amountTooPrecise" };
      assert.deepEqual(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "0.5",
          method: "cash",
        }),
        invalid,
      );
      assert.deepEqual(
        await actions.returnDeposit(reservationId, { amount: "0.5", method: "cash" }),
        invalid,
      );
      assert.deepEqual(
        await actions.recordDamage(reservationId, { amount: "0.5", method: "card", notes: "chip" }),
        invalid,
      );
      assert.equal(await countPayments(reservationId), before, "nothing is written");

      const rental = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "100",
          method: "cash",
        }),
      );
      const returned = paymentIdOf(
        await actions.returnDeposit(reservationId, { amount: "2", method: "cash" }),
      );
      const damage = paymentIdOf(
        await actions.recordDamage(reservationId, { amount: "1", method: "card", notes: "chip" }),
      );
      for (const [id, amount, grossMinor] of [
        [rental, "100.00", 100],
        [returned, "2.00", 2],
        [damage, "1.00", 1],
      ] as const) {
        const row = await readPayment(id);
        assert.deepEqual(
          [row?.amount, row?.currency, row?.grossMinor],
          [amount, "JPY", grossMinor],
        );
      }
    });

    test("a reservation in a three-decimal currency records no payment", async () => {
      const reservationId = await createReservation({ currency: "KWD" });
      const unsupported = { error: "errors.currencyNotSupportedForPayments" };
      assert.deepEqual(
        await actions.recordPayment(reservationId, { type: "rental", amount: "1", method: "cash" }),
        unsupported,
      );
      assert.deepEqual(
        await actions.recordDamage(reservationId, { amount: "1", method: "card", notes: "chip" }),
        unsupported,
      );
      assert.deepEqual(
        await actions.returnDeposit(reservationId, { amount: "1", method: "cash" }),
        unsupported,
      );
      assert.equal(await countPayments(reservationId), 0);
    });

    test("in euros, an amount keeps its two decimals as it always did", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      const ids = [
        paymentIdOf(
          await actions.recordPayment(reservationId, {
            type: "rental",
            amount: "7.5",
            method: "cash",
          }),
        ),
        paymentIdOf(
          await actions.recordPayment(reservationId, {
            type: "adjustment",
            amount: "-20.05",
            method: "card",
          }),
        ),
        paymentIdOf(
          await actions.recordDamage(reservationId, { amount: "0.01", method: "card", notes: "x" }),
        ),
      ];
      assert.deepEqual(await Promise.all(ids.map(async (id) => (await readPayment(id))?.amount)), [
        "7.50",
        "-20.05",
        "0.01",
      ]);
    });

    test("the deposit still returnable is counted in cents: €0.30 less €0.10 leaves €0.20, no more", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "deposit",
          amount: "0.3",
          method: "cash",
        }),
      );
      paymentIdOf(await actions.returnDeposit(reservationId, { amount: "0.1", method: "cash" }));

      assert.deepEqual(
        await actions.returnDeposit(reservationId, { amount: "0.21", method: "cash" }),
        { error: "errors.amountExceedsDeposit" },
      );
      const last = paymentIdOf(
        await actions.returnDeposit(reservationId, { amount: "0.2", method: "cash" }),
      );
      assert.equal((await readPayment(last))?.amount, "0.20");
      assert.deepEqual(
        await actions.returnDeposit(reservationId, { amount: "0.01", method: "cash" }),
        { error: "errors.amountExceedsDeposit" },
      );
    });
  });

  describe("an amount judged as typed", () => {
    test("too many decimals for the currency says so; a malformed amount is still invalid", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      const tooPrecise = { error: "errors.amountTooPrecise" };
      assert.deepEqual(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "19.999",
          method: "cash",
        }),
        tooPrecise,
      );
      assert.deepEqual(
        await actions.recordDamage(reservationId, { amount: "0.004", method: "card", notes: "x" }),
        tooPrecise,
      );
      for (const amount of ["abc", "1e2", "0.000", ""]) {
        assert.deepEqual(
          await actions.recordPayment(reservationId, { type: "rental", amount, method: "cash" }),
          { error: "errors.invalidAmount" },
          JSON.stringify(amount),
        );
      }
      assert.equal(await countPayments(reservationId), 0);
    });

    test("a refund given by hand is judged as typed: €19.999 is refused, not rounded to €20.00", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      const paid = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "30",
          method: "cash",
        }),
      );
      const refund = (amount: string) =>
        actions.refundManualPayment(reservationId, { paymentId: paid, amount, method: "cash" });

      assert.deepEqual(await refund("19.999"), { error: "errors.amountTooPrecise" });
      assert.equal(await countPayments(reservationId), 1, "nothing is written");
      const done = await refund("20.00");
      assert.equal(done.error, undefined);
      assert.ok(done.refundPaymentId);
      assert.equal((await readPayment(done.refundPaymentId))?.amount, "20.00");
    });

    test("a refund of a yen payment has no decimals: ¥0.999 is refused", async () => {
      const reservationId = await createReservation({ currency: "JPY" });
      const paid = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "100",
          method: "cash",
        }),
      );
      assert.deepEqual(
        await actions.refundManualPayment(reservationId, {
          paymentId: paid,
          amount: "0.999",
          method: "cash",
        }),
        { error: "errors.amountTooPrecise" },
      );
      assert.equal(await countPayments(reservationId), 1, "nothing is written");
    });

    test("two returns of the whole deposit sent together: one is recorded, the other refused", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "deposit",
          amount: "50",
          method: "cash",
        }),
      );
      // Both wait on the reservation's lock, held here, then run one after the other.
      const answers = await raceOnLockedRow(
        database,
        { table: "reservations", id: reservationId },
        [
          () => actions.returnDeposit(reservationId, { amount: "50", method: "cash" }),
          () => actions.returnDeposit(reservationId, { amount: "50", method: "cash" }),
        ],
      );
      assert.deepEqual(answers.map((answer) => answer.error ?? "recorded").sort(), [
        "errors.amountExceedsDeposit",
        "recorded",
      ]);
      const returns = await louezDb.db
        .select({ amount: louezDb.payments.amount })
        .from(louezDb.payments)
        .where(
          and(
            eq(louezDb.payments.reservationId, reservationId),
            eq(louezDb.payments.type, "deposit_return"),
          ),
        );
      assert.deepEqual(returns, [{ amount: "50.00" }]);
    });
  });

  describe("an amount as a number input sends it, and nothing but text", () => {
    test("the notations a number input yields for a plain decimal are recorded as that decimal; an exponent is not", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      const ids = [
        paymentIdOf(
          await actions.recordPayment(reservationId, {
            type: "rental",
            amount: ".5",
            method: "cash",
          }),
        ),
        paymentIdOf(
          await actions.recordPayment(reservationId, {
            type: "deposit",
            amount: "12.",
            method: "cash",
          }),
        ),
        paymentIdOf(
          await actions.recordDamage(reservationId, {
            amount: " +2.5 ",
            method: "card",
            notes: "x",
          }),
        ),
        paymentIdOf(await actions.returnDeposit(reservationId, { amount: ".25", method: "cash" })),
      ];
      assert.deepEqual(await Promise.all(ids.map(async (id) => (await readPayment(id))?.amount)), [
        "0.50",
        "12.00",
        "2.50",
        "0.25",
      ]);
      assert.deepEqual(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "5e2",
          method: "cash",
        }),
        { error: "errors.invalidAmount" },
      );
      // No rounding on the way: 19.999 is still too precise.
      assert.deepEqual(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "19.999",
          method: "cash",
        }),
        { error: "errors.amountTooPrecise" },
      );
    });

    test("an action called directly with anything but text refuses it as an invalid amount, writes nothing and does not throw", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      const paid = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "30",
          method: "cash",
        }),
      );
      paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "deposit",
          amount: "30",
          method: "cash",
        }),
      );
      const before = await countPayments(reservationId);
      const invalid = { error: "errors.invalidAmount" };
      for (const crafted of [7, [7], { amount: "7" }, null, undefined]) {
        const amount = crafted as unknown as string;
        const label = JSON.stringify(crafted) ?? "undefined";
        assert.deepEqual(
          await actions.recordPayment(reservationId, { type: "rental", amount, method: "cash" }),
          invalid,
          label,
        );
        assert.deepEqual(
          await actions.recordDamage(reservationId, { amount, method: "card", notes: "x" }),
          invalid,
          label,
        );
        assert.deepEqual(
          await actions.returnDeposit(reservationId, { amount, method: "cash" }),
          invalid,
          label,
        );
        assert.deepEqual(
          await actions.refundManualPayment(reservationId, {
            paymentId: paid,
            amount,
            method: "cash",
          }),
          invalid,
          label,
        );
      }
      assert.equal(await countPayments(reservationId), before, "nothing is written");
    });
  });

  describe("a record named by anything but a non-empty string", () => {
    test("each payment action refuses it as not found, writes nothing and does not throw", async () => {
      const store = Reflect.get(globalThis, STORE_KEY);
      // Stripe configured, so the deposit and request actions reach their id check.
      Reflect.set(globalThis, STORE_KEY, {
        ...store,
        stripeAccountId: "acct_actions",
        stripeChargesEnabled: true,
      });
      const reservationId = await createReservation({ currency: "EUR" });
      const paid = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "rental",
          amount: "30",
          method: "cash",
        }),
      );
      const before = await countPayments(reservationId);
      const notFound = { error: "errors.reservationNotFound" };
      const paymentNotFound = { error: "errors.paymentNotFound" };
      try {
        // The last one is longer than any id: refused before a read like the others.
        for (const crafted of [[], "", 7, null, undefined, { id: reservationId }, "x".repeat(22)]) {
          const id = crafted as unknown as string;
          const label = JSON.stringify(crafted) ?? "undefined";
          const table: Array<[string, Promise<unknown>, unknown]> = [
            [
              "recordPayment",
              actions.recordPayment(id, { type: "rental", amount: "10", method: "cash" }),
              notFound,
            ],
            [
              "recordDamage",
              actions.recordDamage(id, { amount: "10", method: "cash", notes: "x" }),
              notFound,
            ],
            [
              "returnDeposit",
              actions.returnDeposit(id, { amount: "10", method: "cash" }),
              notFound,
            ],
            [
              "refundManualPayment (reservation)",
              actions.refundManualPayment(id, { paymentId: paid, amount: "10", method: "cash" }),
              notFound,
            ],
            [
              "refundManualPayment (payment)",
              actions.refundManualPayment(reservationId, {
                paymentId: id,
                amount: "10",
                method: "cash",
              }),
              paymentNotFound,
            ],
            ["deletePayment", actions.deletePayment(id), paymentNotFound],
            [
              "requestPayment",
              actions.requestPayment(id, {
                type: "custom",
                amount: "10",
                channels: { email: true, sms: false },
              }),
              notFound,
            ],
            ["createDepositHold", actions.createDepositHold(id), notFound],
            [
              "captureDepositHold",
              actions.captureDepositHold(id, { amount: "10", reason: "x" }),
              notFound,
            ],
            ["releaseDepositHold", actions.releaseDepositHold(id), notFound],
          ];
          for (const [name, call, expected] of table) {
            assert.deepEqual(await call, expected, `${name} ${label}`);
          }
        }
        assert.equal(await countPayments(reservationId), before, "nothing is written");
      } finally {
        Reflect.set(globalThis, STORE_KEY, store);
      }
    });

    test("a capture amount that is not text is refused as invalid, without throwing", async () => {
      const reservationId = await createReservation({ currency: "EUR" });
      for (const crafted of [5, ["5"], null, undefined]) {
        assert.deepEqual(
          await actions.captureDepositHold(reservationId, {
            amount: crafted as unknown as string,
            reason: "x",
          }),
          { error: "errors.invalidAmount" },
          JSON.stringify(crafted) ?? "undefined",
        );
      }
    });
  });

  describe("deletePayment", () => {
    test("deletes the payment and marks the reservation", async () => {
      const reservationId = await createReservation();
      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, { type: "damage", amount: "5", method: "cash" }),
      );

      assert.deepEqual(await actions.deletePayment(paymentId), { success: true });

      assert.equal(await readPayment(paymentId), undefined);
      assert.equal(await readMarkVersion(reservationId), 2);
    });

    test("a Stripe payment is not deleted and nothing is marked", async () => {
      const reservationId = await createReservation();
      const paymentId = nextId("pay");
      await louezDb.db.insert(louezDb.payments).values({
        id: paymentId,
        reservationId,
        amount: "20.00",
        type: "rental",
        method: "stripe",
        status: "completed",
      });

      assert.deepEqual(await actions.deletePayment(paymentId), {
        error: "errors.cannotDeleteStripePayment",
      });
      assert.equal(await countPayments(reservationId), 1);
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });

  describe("updateReservation", () => {
    test("an edit marks the reservation in its transaction", async () => {
      const reservationId = await createReservation();
      const newEnd = new Date("2026-04-13T09:00:00.000Z");

      const result = await actions.updateReservation(reservationId, { endDate: newEnd });

      assert.equal("error" in result ? result.error : undefined, undefined);
      const [row] = await louezDb.db
        .select({ endDate: louezDb.reservations.endDate })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.deepEqual(row?.endDate, newEnd);
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("an edited checkout booking in a store that prices before tax keeps its tax in the snapshot", async () => {
      const storeId = "store_actions_ht";
      const settings = {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        currency: "eur",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" as const },
      };
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: storeId, userId: "user_ht", name: "HT", slug: "actions-ht", settings });
      await louezDb.db.insert(louezDb.products).values({
        id: "product_ht",
        storeId,
        name: "Bike",
        price: "50.00",
        pricingMode: "day",
      });
      // What the checkout writes for two days at 50.00 before tax: the item with
      // its rate and split, a total of 120.00 tax included.
      const reservationId = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId,
        customerId: "customer_actions",
        number: reservationId,
        status: "pending",
        startDate: START,
        endDate: END,
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "120.00",
        subtotalExclTax: "100.00",
        taxAmount: "20.00",
        taxRate: "20.00",
        source: "online",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId,
        productId: "product_ht",
        quantity: 1,
        unitPrice: "50.00",
        depositPerUnit: "0.00",
        totalPrice: "100.00",
        taxRate: "20.00",
        taxAmount: "20.00",
        priceExclTax: "50.00",
        totalExclTax: "100.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      });

      const previousStore = Reflect.get(globalThis, STORE_KEY);
      Reflect.set(globalThis, STORE_KEY, {
        id: storeId,
        userId: "",
        name: "HT",
        slug: "actions-ht",
        settings,
        stripeAccountId: null,
      });
      try {
        const result = await actions.updateReservation(reservationId, {
          endDate: new Date("2026-04-13T09:00:00.000Z"),
        });
        assert.equal("error" in result ? result.error : undefined, undefined);
      } finally {
        Reflect.set(globalThis, STORE_KEY, previousStore);
      }

      // The edit reprices the item before tax, and the tax engine adds its 20 % (slice 10).
      const [row] = await louezDb.db
        .select({
          totalAmount: louezDb.reservations.totalAmount,
          subtotalExclTax: louezDb.reservations.subtotalExclTax,
          taxAmount: louezDb.reservations.taxAmount,
        })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.deepEqual(
        [row?.totalAmount, row?.subtotalExclTax, row?.taxAmount],
        ["180.00", "150.00", "30.00"],
      );

      const { buildSnapshot } = await import("@/lib/billing-sync/snapshots/build-snapshot");
      const built = await buildSnapshot(
        louezDb.db,
        { type: "reservation", aggregateId: reservationId, storeId },
        { newStoresFrom: new Date("2027-01-25T00:00:00Z") },
      );
      assert.ok(built.kind === "snapshot" && "totalInclTaxMinor" in built.data);
      // 150.00 before tax at the item's 20 %, as the checkout would have charged it.
      assert.equal(built.data.totalInclTaxMinor, 18000);
    });

    test("a refused edit marks nothing", async () => {
      const reservationId = await createReservation();

      const result = await actions.updateReservation(reservationId, {
        endDate: new Date("2026-04-01T09:00:00.000Z"),
      });

      assert.deepEqual(result, { error: "errors.endDateBeforeStart" });
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });

  describe("createManualReservation and the card gate", () => {
    // A store created after BILLING_NEW_STORES_FROM that no policy covers: its gate
    // fails closed (README §8.3). No M2 store is in this case.
    const GATE_STORE = "store_actions_gate";
    const saved = { newStoresFrom: process.env.BILLING_NEW_STORES_FROM };

    before(async () => {
      await louezDb.db.insert(louezDb.stores).values({
        id: GATE_STORE,
        userId: "owner_actions_gate",
        name: "Gate",
        slug: "actions-gate",
        createdAt: new Date("2027-02-01T00:00:00Z"),
      });
    });

    beforeEach(() => {
      process.env.BILLING_NEW_STORES_FROM = "2027-01-25T00:00:00Z";
      Reflect.set(globalThis, STORE_KEY, {
        id: GATE_STORE,
        userId: "",
        name: "Gate",
        slug: "actions-gate",
        settings: { currency: "eur" },
        stripeAccountId: null,
      });
    });

    afterEach(() => {
      if (saved.newStoresFrom === undefined) delete process.env.BILLING_NEW_STORES_FROM;
      else process.env.BILLING_NEW_STORES_FROM = saved.newStoresFrom;
      Reflect.set(globalThis, STORE_KEY, {
        id: STORE,
        userId: "",
        name: "Actions",
        slug: "actions",
        settings: { currency: "usd" },
        stripeAccountId: null,
      });
    });

    const booking = (email: string, sendAsQuote: boolean) => ({
      newCustomer: { email, firstName: "Walk", lastName: "In" },
      startDate: START,
      endDate: END,
      items: [],
      customItems: [
        {
          name: "Bike",
          description: "",
          unitPrice: 20,
          deposit: 0,
          quantity: 1,
          pricingMode: "day" as const,
        },
      ],
      sendAsQuote,
    });

    async function storeRows(email: string) {
      const customerRows = await louezDb.db
        .select({ id: louezDb.customers.id })
        .from(louezDb.customers)
        .where(and(eq(louezDb.customers.storeId, GATE_STORE), eq(louezDb.customers.email, email)));
      const reservationRows = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.storeId, GATE_STORE));
      return {
        customers: customerRows.length,
        statuses: reservationRows.map((row) => row.status),
      };
    }

    test("a booking created as confirmed is refused before the new customer is written", async () => {
      const email = "refused@example.test";
      assert.deepEqual(await actions.createManualReservation(booking(email, false)), {
        error: "errors.storeNotAcceptingReservations",
      });
      assert.deepEqual(await storeRows(email), { customers: 0, statuses: [] });
    });

    test("a quote never asks the gate", async () => {
      const email = "quote@example.test";
      const result = await actions.createManualReservation(booking(email, true));
      assert.equal(result.error, undefined);
      assert.deepEqual(await storeRows(email), { customers: 1, statuses: ["quote"] });
    });
  });

  describe("requestPayment", () => {
    test("the payment and deposit requests speak the reservation's language, email and SMS", async () => {
      const store = Reflect.get(globalThis, STORE_KEY);
      Reflect.set(globalThis, STORE_KEY, {
        ...store,
        settings: { currency: "eur", country: "FR" },
        stripeAccountId: "acct_actions",
        stripeChargesEnabled: true,
        customerNotificationSettings: {
          templates: { customer_payment_requested: { smsMessage: "Pay #{number}: {paymentUrl}" } },
        },
      });
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: "+33612345678" })
        .where(eq(louezDb.customers.id, "customer_actions"));
      try {
        const reservationId = await createReservation({ withItems: true });
        await louezDb.db
          .update(louezDb.reservations)
          .set({ locale: "de" })
          .where(eq(louezDb.reservations.id, reservationId));
        Reflect.set(globalThis, SENT_KEY, []);

        for (const type of ["rental", "deposit"] as const) {
          const result = await actions.requestPayment(reservationId, {
            type,
            channels: { email: true, sms: true },
          });
          assert.equal(result.error, undefined, type);
        }
        const sent = Reflect.get(globalThis, SENT_KEY) as Array<{
          channel: string;
          name: string;
          params: { locale?: string; customMessage?: string };
        }>;
        assert.deepEqual(
          sent.map(({ channel, name, params }) => [channel, name, params.locale]),
          [
            ["email", "sendPaymentRequestEmail", "de"],
            ["sms", "sendPaymentRequestSms", "de"],
            ["email", "sendDepositAuthorizationRequestEmail", "de"],
            ["sms", "sendDepositAuthorizationRequestSms", "de"],
          ],
        );
        assert.equal(sent[1]?.params.customMessage, "Pay #{number}: {paymentUrl}");
      } finally {
        Reflect.set(globalThis, STORE_KEY, store);
        Reflect.deleteProperty(globalThis, SENT_KEY);
        await louezDb.db
          .update(louezDb.customers)
          .set({ phone: null })
          .where(eq(louezDb.customers.id, "customer_actions"));
      }
    });

    test("a request is in the reservation's currency, not the store's of today, on every channel", async () => {
      const store = Reflect.get(globalThis, STORE_KEY);
      // The store has moved to dollars since the reservation was booked in pounds.
      Reflect.set(globalThis, STORE_KEY, {
        ...store,
        settings: { currency: "usd", country: "GB" },
        stripeAccountId: "acct_actions",
        stripeChargesEnabled: true,
      });
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: "+447700900123" })
        .where(eq(louezDb.customers.id, "customer_actions"));
      try {
        const reservationId = await createReservation({ withItems: true });
        await louezDb.db
          .update(louezDb.reservations)
          .set({ currency: "GBP" })
          .where(eq(louezDb.reservations.id, reservationId));
        Reflect.set(globalThis, SENT_KEY, []);

        for (const type of ["rental", "deposit"] as const) {
          const result = await actions.requestPayment(reservationId, {
            type,
            channels: { email: true, sms: true },
          });
          assert.equal(result.error, undefined, type);
        }

        const sent = Reflect.get(globalThis, SENT_KEY) as Array<{
          channel: string;
          name: string;
          params: { currency?: string; reservation?: { currency?: string } };
        }>;
        assert.deepEqual(
          sent.map(({ channel, name, params }) => [
            name,
            channel === "email" ? params.reservation?.currency : params.currency,
          ]),
          [
            ["sendPaymentRequestEmail", "GBP"],
            ["sendPaymentRequestSms", "GBP"],
            ["sendDepositAuthorizationRequestEmail", "GBP"],
            ["sendDepositAuthorizationRequestSms", "GBP"],
          ],
        );
        // What the customer's payment page will charge.
        const requests = await louezDb.db
          .select({
            amount: louezDb.paymentRequests.amount,
            currency: louezDb.paymentRequests.currency,
          })
          .from(louezDb.paymentRequests)
          .where(eq(louezDb.paymentRequests.reservationId, reservationId));
        assert.deepEqual(requests, [{ amount: "110.00", currency: "GBP" }]);
      } finally {
        Reflect.set(globalThis, STORE_KEY, store);
        Reflect.deleteProperty(globalThis, SENT_KEY);
        await louezDb.db
          .update(louezDb.customers)
          .set({ phone: null })
          .where(eq(louezDb.customers.id, "customer_actions"));
      }
    });

    test("a custom amount is judged as typed in the reservation's currency: nothing is created or sent on a refusal", async () => {
      const store = Reflect.get(globalThis, STORE_KEY);
      Reflect.set(globalThis, STORE_KEY, {
        ...store,
        settings: { currency: "eur", country: "FR" },
        stripeAccountId: "acct_actions",
        stripeChargesEnabled: true,
      });
      Reflect.set(globalThis, SENT_KEY, []);
      const ask = (reservationId: string, amount: unknown) =>
        actions.requestPayment(reservationId, {
          type: "custom",
          amount: amount as string,
          channels: { email: true, sms: false },
        });
      const requestsOf = (reservationId: string) =>
        louezDb.db
          .select({
            amount: louezDb.paymentRequests.amount,
            currency: louezDb.paymentRequests.currency,
          })
          .from(louezDb.paymentRequests)
          .where(eq(louezDb.paymentRequests.reservationId, reservationId));
      try {
        const euros = await createReservation({ currency: "EUR" });
        const yen = await createReservation({ currency: "JPY" });

        assert.deepEqual(await ask(euros, "19.999"), { error: "errors.amountTooPrecise" });
        assert.deepEqual(await ask(yen, "0.5"), { error: "errors.amountTooPrecise" });
        for (const crafted of [20, [20], null]) {
          assert.deepEqual(await ask(euros, crafted), { error: "errors.invalidAmount" });
        }
        assert.deepEqual(await requestsOf(euros), [], "nothing is created");
        assert.deepEqual(await requestsOf(yen), []);
        assert.deepEqual(Reflect.get(globalThis, SENT_KEY), [], "nothing is sent");

        const done = await ask(euros, "20.00");
        assert.equal(done.error, undefined);
        assert.deepEqual(await requestsOf(euros), [{ amount: "20.00", currency: "EUR" }]);
        assert.equal((Reflect.get(globalThis, SENT_KEY) as unknown[]).length, 1);
      } finally {
        Reflect.set(globalThis, STORE_KEY, store);
        Reflect.deleteProperty(globalThis, SENT_KEY);
      }
    });
  });
});
