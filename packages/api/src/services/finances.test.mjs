import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as orm from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as paymentReceipts from "@louez/db/payment-receipts";
import * as schema from "@louez/db/schema";
import movementUtils from "../../../utils/src/util.payment-movement.ts";
import periodUtils from "../../../utils/src/util.finance-period.ts";

// Runs the real query builders of `finances.ts` against an in-memory SQLite,
// the way `analytics/sales/queries.test.mjs` does: no app auth, no live database.
function loadService(db) {
  const source = readFileSync(new URL("./finances.ts", import.meta.url), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  const code = stripTypeScriptTypes(
    source.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, ""),
  );
  class ORPCError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  return runInNewContext(`${code}; ({${functions.join(",")}})`, {
    ...orm,
    ...schema,
    ...paymentReceipts,
    ...movementUtils,
    ...periodUtils,
    db,
    alias,
    ORPCError,
    Date,
  });
}

const stamp = (date) => date.toISOString().slice(0, -1).replace("T", " ");

/** Values built inside the VM context carry another realm's prototypes: compare plain copies. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("GREATEST", { varargs: true }, (...args) =>
    args.reduce((a, b) => (a > b ? a : b)),
  );
  sqlite.exec(`
    CREATE TABLE reservations (id TEXT, store_id TEXT, customer_id TEXT, number TEXT, reservation_status TEXT, start_date TEXT, end_date TEXT, total_amount REAL, subtotal_amount REAL, deposit_amount REAL);
    CREATE TABLE customers (id TEXT, first_name TEXT, last_name TEXT, company_name TEXT);
    CREATE TABLE payments (id TEXT, reservation_id TEXT, amount REAL, payment_type TEXT, payment_method TEXT, payment_status TEXT, stripe_payment_intent_id TEXT, stripe_charge_id TEXT, stripe_checkout_session_id TEXT, stripe_refund_id TEXT, refund_of_payment_id TEXT, authorization_expires_at TEXT, currency TEXT, notes TEXT, paid_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE invoices (id TEXT, store_id TEXT, number TEXT, type TEXT);
    CREATE TABLE invoice_payments (id TEXT, invoice_id TEXT, payment_id TEXT);
    INSERT INTO customers VALUES ('lefevre', 'Thomas', 'Lefèvre', NULL), ('caron', 'Marie', 'Caron', 'Caron SARL');
    INSERT INTO reservations VALUES
      ('r1', 'store', 'lefevre', 'R-1042', 'confirmed', '2026-09-20 08:00:00.000', '2026-09-22 08:00:00.000', 300, 300, 0),
      ('r2', 'store', 'caron', 'R-1038', 'completed', '2026-09-01 08:00:00.000', '2026-09-03 08:00:00.000', 200, 200, 0),
      ('foreign', 'other-store', 'caron', 'X-1', 'confirmed', '2026-09-01 08:00:00.000', '2026-09-03 08:00:00.000', 1000, 1000, 0);
  `);
  const db = drizzle(async (sql, params) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true);
    return {
      rows: statement.all(...params.map((value) => (value instanceof Date ? stamp(value) : value))),
    };
  });
  const pay = (
    id,
    amount,
    date,
    {
      reservation = "r1",
      type = "rental",
      method = "cash",
      status = "completed",
      intent = null,
      charge = null,
      session = null,
      stripeRefund = null,
      refundOf = null,
      expiresAt = null,
      notes = null,
      paidAt = true,
    } = {},
  ) => {
    sqlite
      .prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        reservation,
        amount,
        type,
        method,
        status,
        intent,
        charge,
        session,
        stripeRefund,
        refundOf,
        expiresAt ? stamp(expiresAt) : null,
        "EUR",
        notes,
        paidAt ? stamp(date) : null,
        stamp(date),
        stamp(date),
      );
  };
  return { sqlite, service: loadService(db), pay };
}

const timezone = "Europe/Paris";
// 18 Sept 2026, 17:00 in Paris.
const now = new Date("2026-09-18T15:00:00Z");
const month = { period: "month" };
const day = (iso) => new Date(iso);

const stripeCharge = { method: "stripe", intent: "pi_1", charge: "ch_1" };
const stripeRefund = { method: "stripe", stripeRefund: "re_1" };

test("a Stripe charge refunded in full nets to zero: +100 on its day, −100 on the refund day", async () => {
  const f = fixture();
  try {
    // The webhook brought the charge down to 0 and flagged it `refunded`.
    f.pay("charge", 0, day("2026-09-10T09:00:00Z"), { ...stripeCharge, status: "refunded" });
    f.pay("refund", 100, day("2026-09-12T09:00:00Z"), { ...stripeRefund, refundOf: "charge" });

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.totals.moneyIn, 100);
    assert.equal(summary.totals.moneyOut, 100);
    assert.equal(summary.totals.net, 0);
    assert.deepEqual(plain(summary.series.filter((point) => point.moneyIn || point.moneyOut)), [
      { key: "2026-09-10", moneyIn: 100, moneyOut: 0 },
      { key: "2026-09-12", moneyIn: 0, moneyOut: 100 },
    ]);
  } finally {
    f.sqlite.close();
  }
});

test("a partial Stripe refund reads +100 −30, a manual refund leaves the cash row gross", async () => {
  const f = fixture();
  try {
    f.pay("charge", 70, day("2026-09-10T09:00:00Z"), stripeCharge);
    f.pay("stripe-refund", 30, day("2026-09-11T09:00:00Z"), {
      ...stripeRefund,
      refundOf: "charge",
    });
    f.pay("cash", 100, day("2026-09-10T10:00:00Z"));
    f.pay("cash-refund", 30, day("2026-09-11T10:00:00Z"), { refundOf: "cash" });

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.totals.moneyIn, 200);
    assert.equal(summary.totals.moneyOut, 60);
    assert.equal(summary.totals.net, 140);
    assert.deepEqual(
      summary.byMethod.map((row) => [row.method, row.moneyIn, row.moneyOut, row.count]),
      [
        ["cash", 100, 30, 2],
        ["stripe", 100, 30, 2],
      ],
    );

    const { movements } = await f.service.getFinanceMovements({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.deepEqual(
      movements.map((row) => [row.id, row.nature, row.direction, row.amount]),
      [
        ["cash-refund", "refund", "out", -30],
        ["stripe-refund", "refund", "out", -30],
        ["cash", "rental", "in", 100],
        ["charge", "rental", "in", 100],
      ],
    );
  } finally {
    f.sqlite.close();
  }
});

test("an unlinked legacy Stripe refund still goes out while its charge stays net", async () => {
  const f = fixture();
  try {
    f.pay("charge", 70, day("2026-09-10T09:00:00Z"), stripeCharge);
    f.pay("refund", 30, day("2026-09-11T09:00:00Z"), stripeRefund);
    // Old webhooks stamped the refund id on the netted charge itself: still a receipt.
    f.pay("stamped", 50, day("2026-09-10T09:00:00Z"), { ...stripeCharge, stripeRefund: "re_old" });

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.totals.moneyIn, 120);
    assert.equal(summary.totals.moneyOut, 30);
  } finally {
    f.sqlite.close();
  }
});

test("pending, held, failed and foreign rows never reach a total; a captured hold yields to its capture", async () => {
  const f = fixture();
  try {
    const at = day("2026-09-10T09:00:00Z");
    f.pay("paid", 100, at);
    f.pay("pending", 80, at, { status: "pending", paidAt: false });
    f.pay("hold", 500, at, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
      intent: "pi_h",
    });
    f.pay("failed", 60, at, { status: "failed" });
    f.pay("cancelled", 60, at, { status: "cancelled" });
    f.pay("captured-hold", 400, at, {
      reservation: "r2",
      type: "deposit_hold",
      method: "stripe",
      intent: "pi_c",
    });
    f.pay("capture", 120, at, {
      reservation: "r2",
      type: "deposit_capture",
      method: "stripe",
      intent: "pi_c",
    });
    f.pay("foreign", 1000, at, { reservation: "foreign" });
    f.pay("before", 40, day("2026-08-31T21:59:59Z"));
    f.pay("future", 40, day("2026-09-19T09:00:00Z"));

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.totals.moneyIn, 220);
    assert.equal(summary.totals.movementCount, 2);
    assert.equal(summary.hasPayments, true);

    const list = await f.service.getFinanceMovements({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.deepEqual(list.movements.map((row) => row.id).sort(), [
      "capture",
      "hold",
      "paid",
      "pending",
    ]);
    assert.equal(list.totalCount, 4);
    assert.deepEqual(
      list.movements
        .filter((row) => !row.counted)
        .map((row) => [row.id, row.status])
        .sort(),
      [
        ["hold", "held"],
        ["pending", "pending"],
      ],
    );
    // The day's subtotal leaves the pending and held rows out.
    assert.deepEqual(plain(list.days), [
      { key: "2026-09-10", moneyIn: 220, moneyOut: 0, net: 220 },
    ]);

    const failed = await f.service.getFinanceMovements({
      storeId: "store",
      timezone,
      period: month,
      filters: { status: "failed" },
      now,
    });
    assert.deepEqual(
      failed.movements.map((row) => [row.id, row.counted]),
      [["failed", false]],
    );
  } finally {
    f.sqlite.close();
  }
});

test("deposits, negative adjustments and damages follow the ledger rule", async () => {
  const f = fixture();
  try {
    const at = day("2026-09-10T09:00:00Z");
    f.pay("deposit", 300, at, { type: "deposit" });
    f.pay("deposit-return", 300, day("2026-09-12T09:00:00Z"), { type: "deposit_return" });
    f.pay("damage", 45, at, { type: "damage" });
    f.pay("discount", -12.5, at, { type: "adjustment" });

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.totals.moneyIn, 345);
    assert.equal(summary.totals.moneyOut, 312.5);

    const out = await f.service.getFinanceMovements({
      storeId: "store",
      timezone,
      period: month,
      filters: { direction: "out" },
      now,
    });
    assert.deepEqual(
      out.movements.map((row) => [row.id, row.nature, row.amount]),
      [
        ["deposit-return", "deposit_return", -300],
        ["discount", "adjustment", -12.5],
      ],
    );
  } finally {
    f.sqlite.close();
  }
});

test("the list, its day subtotals and the summary agree, page after page", async () => {
  const f = fixture();
  try {
    f.pay("a", 100, day("2026-09-15T09:00:00Z"));
    f.pay("b", 50, day("2026-09-15T10:00:00Z"), { method: "card" });
    f.pay("c", 20, day("2026-09-15T11:00:00Z"), { refundOf: "a" });
    // 23:30 in Paris on the 15th is still the 15th, although already the 16th in UTC+3 stores.
    f.pay("late", 10, day("2026-09-15T21:30:00Z"));
    f.pay("d", 80, day("2026-09-16T09:00:00Z"), { reservation: "r2" });

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    const firstPage = await f.service.getFinanceMovements({
      storeId: "store",
      timezone,
      period: month,
      page: 1,
      pageSize: 25,
      now,
    });
    assert.equal(firstPage.totalCount, 5);
    assert.equal(
      firstPage.movements.reduce((sum, row) => sum + row.amount, 0),
      summary.totals.net,
    );
    assert.deepEqual(plain(firstPage.days), [
      { key: "2026-09-15", moneyIn: 160, moneyOut: 20, net: 140 },
      { key: "2026-09-16", moneyIn: 80, moneyOut: 0, net: 80 },
    ]);
    assert.deepEqual(
      firstPage.movements.map((row) => [row.id, row.dayKey]),
      [
        ["d", "2026-09-16"],
        ["late", "2026-09-15"],
        ["c", "2026-09-15"],
        ["b", "2026-09-15"],
        ["a", "2026-09-15"],
      ],
    );

    const recap = await f.service.getFinanceRecap({
      storeId: "store",
      timezone,
      period: month,
      now,
      limit: 3,
    });
    assert.equal(recap.movements.length, 3);
    assert.equal(recap.truncated, true);
  } finally {
    f.sqlite.close();
  }
});

test("filters narrow the list: method, nature, amount bounds and search", async () => {
  const f = fixture();
  try {
    const at = day("2026-09-10T09:00:00Z");
    f.pay("cash", 100, at);
    f.pay("card", 250, at, { method: "card", reservation: "r2" });
    f.pay("refund", 40, at, { refundOf: "cash" });
    f.pay("deposit", 300, at, { type: "deposit", reservation: "r2" });

    const ids = async (filters) =>
      (
        await f.service.getFinanceMovements({
          storeId: "store",
          timezone,
          period: month,
          filters,
          now,
        })
      ).movements
        .map((row) => row.id)
        .sort();

    assert.deepEqual(await ids({ method: "card" }), ["card"]);
    assert.deepEqual(await ids({ nature: "refund" }), ["refund"]);
    assert.deepEqual(await ids({ nature: "rental" }), ["card", "cash"]);
    assert.deepEqual(await ids({ minAmount: 100, maxAmount: 250 }), ["card", "cash"]);
    assert.deepEqual(await ids({ direction: "in", minAmount: 260 }), ["deposit"]);
    assert.deepEqual(await ids({ search: "caron" }), ["card", "deposit"]);
    assert.deepEqual(await ids({ search: "Thomas Lef" }), ["cash", "refund"]);
    assert.deepEqual(await ids({ search: "R-1038" }), ["card", "deposit"]);
    assert.deepEqual(await ids({ search: "SARL" }), ["card", "deposit"]);
  } finally {
    f.sqlite.close();
  }
});

test("trends compare with the same stretch of the previous period", async () => {
  const f = fixture();
  try {
    f.pay("today", 150, day("2026-09-18T08:00:00Z"));
    f.pay("yesterday-morning", 100, day("2026-09-17T08:00:00Z"));
    // After 17:00 yesterday: outside the stretch today is compared with.
    f.pay("yesterday-evening", 500, day("2026-09-17T18:00:00Z"));

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: { period: "today" },
      now,
    });
    assert.equal(summary.totals.moneyIn, 150);
    assert.equal(summary.totals.moneyInGrowth, 50);
    assert.deepEqual(plain(summary.window), {
      period: "today",
      from: "2026-09-18",
      to: "2026-09-18",
      timezone,
      granularity: "day",
    });
  } finally {
    f.sqlite.close();
  }
});

test("outstanding balances: per reservation, any date, refunds restored once, Stripe refund rows ignored", async () => {
  const f = fixture();
  try {
    // r1 (300 due): 200 paid in cash, 20 given back by hand → 120 left.
    f.pay("r1-paid", 200, day("2026-09-01T09:00:00Z"));
    f.pay("r1-refund", 20, day("2026-09-02T09:00:00Z"), { refundOf: "r1-paid" });
    f.pay("r1-deposit", 500, day("2026-09-01T09:00:00Z"), { type: "deposit" });
    // r2 (200 due, already completed): charge netted to 150 by a linked Stripe
    // refund of 50 → 50 left, not 100.
    f.pay("r2-charge", 150, day("2026-08-30T09:00:00Z"), { ...stripeCharge, reservation: "r2" });
    f.pay("r2-refund", 50, day("2026-08-31T09:00:00Z"), {
      ...stripeRefund,
      reservation: "r2",
      refundOf: "r2-charge",
    });
    f.sqlite.exec(
      "INSERT INTO reservations VALUES ('r3', 'store', 'caron', 'R-2000', 'cancelled', '2026-09-01 08:00:00.000', '2026-09-03 08:00:00.000', 900, 900, 0), ('r4', 'store', 'caron', 'R-2001', 'ongoing', '2026-09-17 08:00:00.000', '2026-09-19 08:00:00.000', 80, 80, 0)",
    );
    f.pay("r4-paid", 80, day("2026-09-17T09:00:00Z"), { reservation: "r4" });

    const result = await f.service.getFinanceOutstanding({ storeId: "store", now });
    assert.deepEqual(
      result.reservations.map((row) => [row.number, row.total, row.paid, row.remaining]),
      [
        ["R-1038", 200, 150, 50],
        ["R-1042", 300, 180, 120],
      ],
    );
    assert.equal(result.total, 170);
    assert.equal(result.totalCount, 2);

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.deepEqual(plain(summary.outstanding), { total: 170, reservationCount: 2 });
  } finally {
    f.sqlite.close();
  }
});

test("deposits: active holds by expiry, cashed deposits still to return, recent history", async () => {
  const f = fixture();
  try {
    const at = day("2026-09-10T09:00:00Z");
    f.pay("hold-late", 500, at, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
      intent: "pi_a",
      expiresAt: day("2026-09-25T09:00:00Z"),
    });
    f.pay("hold-soon", 300, at, {
      reservation: "r2",
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
      intent: "pi_b",
      expiresAt: day("2026-09-19T09:00:00Z"),
    });
    f.pay("released", 200, day("2026-09-05T09:00:00Z"), {
      type: "deposit_hold",
      method: "stripe",
      status: "cancelled",
      paidAt: false,
    });
    // r2 is completed and still holds 250 of a 400 cash deposit.
    f.pay("deposit", 400, at, { reservation: "r2", type: "deposit" });
    f.pay("partial-return", 150, day("2026-09-11T09:00:00Z"), {
      reservation: "r2",
      type: "deposit_return",
    });
    // The refund of a capture gives back damage money, not the deposit.
    f.pay("capture", 100, at, {
      reservation: "r2",
      type: "deposit_capture",
      method: "stripe",
      intent: "pi_c",
    });
    f.pay("capture-refund", 40, day("2026-09-12T09:00:00Z"), {
      reservation: "r2",
      type: "deposit_return",
      refundOf: "capture",
    });
    // r1 got its deposit back in full: nothing left to return.
    f.pay("r1-deposit", 100, at, { type: "deposit" });
    f.pay("r1-return", 100, day("2026-09-12T10:00:00Z"), { type: "deposit_return" });

    const deposits = await f.service.getFinanceDeposits({ storeId: "store" });
    assert.deepEqual(
      deposits.holds.map((row) => row.paymentId),
      ["hold-soon", "hold-late"],
    );
    assert.equal(deposits.holdsTotal, 800);
    assert.deepEqual(
      deposits.toReturn.map((row) => [
        row.reservationNumber,
        row.cashed,
        row.returned,
        row.remaining,
      ]),
      [["R-1038", 400, 150, 250]],
    );
    assert.equal(deposits.toReturnTotal, 250);
    assert.deepEqual(
      deposits.history.map((row) => [row.paymentId, row.event]),
      [
        ["r1-return", "returned"],
        ["capture-refund", "returned"],
        ["partial-return", "returned"],
        ["r1-deposit", "cashed"],
        ["deposit", "cashed"],
        ["capture", "captured"],
        ["released", "released"],
      ],
    );

    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.depositCount, 3);
  } finally {
    f.sqlite.close();
  }
});

test("a movement's detail links a charge to its refunds and stays inside the store", async () => {
  const f = fixture();
  try {
    f.pay("charge", 70, day("2026-09-10T09:00:00Z"), {
      ...stripeCharge,
      notes: "Paiement en ligne",
    });
    f.pay("refund", 30, day("2026-09-11T09:00:00Z"), { ...stripeRefund, refundOf: "charge" });
    f.pay("foreign", 10, day("2026-09-11T09:00:00Z"), { reservation: "foreign" });
    f.sqlite.exec(
      "INSERT INTO invoices VALUES ('inv', 'store', 'F-2026-001', 'invoice'); INSERT INTO invoice_payments VALUES ('ip', 'inv', 'charge')",
    );

    const charge = await f.service.getFinanceMovementDetail({
      storeId: "store",
      timezone,
      paymentId: "charge",
    });
    assert.equal(charge.movement.amount, 100);
    assert.equal(charge.movement.storedAmount, 70);
    assert.equal(charge.movement.notes, "Paiement en ligne");
    assert.equal(charge.movement.stripeChargeId, "ch_1");
    assert.deepEqual(
      charge.refunds.map((row) => [row.id, row.amount]),
      [["refund", -30]],
    );
    assert.deepEqual({ ...charge.invoice }, { id: "inv", number: "F-2026-001", type: "invoice" });

    const refund = await f.service.getFinanceMovementDetail({
      storeId: "store",
      timezone,
      paymentId: "refund",
    });
    assert.equal(refund.original?.id, "charge");
    assert.equal(refund.original?.amount, 100);

    await assert.rejects(
      f.service.getFinanceMovementDetail({ storeId: "store", timezone, paymentId: "foreign" }),
      /NOT_FOUND/,
    );
  } finally {
    f.sqlite.close();
  }
});

test("a store without any payment is flagged for the first-use block", async () => {
  const f = fixture();
  try {
    const summary = await f.service.getFinanceSummary({
      storeId: "store",
      timezone,
      period: month,
      now,
    });
    assert.equal(summary.hasPayments, false);
    assert.equal(summary.totals.net, 0);
    assert.equal(summary.series.length, 18);
  } finally {
    f.sqlite.close();
  }
});
