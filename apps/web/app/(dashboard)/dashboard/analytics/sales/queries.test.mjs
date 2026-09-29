import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as orm from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { enUS } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import * as paymentReceipts from "@louez/db/payment-receipts";
import * as schema from "@louez/db/schema";
import windowUtils from "./util.sales-window.ts";

// Exercise the actual query builders without loading app auth or opening a live database.
function loadQueries(file, db, extra = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  const code = stripTypeScriptTypes(
    source.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, ""),
  );
  return runInNewContext(`${code}; ({${functions.join(",")}})`, {
    ...orm,
    ...schema,
    ...paymentReceipts,
    ...windowUtils,
    db,
    alias,
    formatInTimeZone,
    Date,
    ...extra,
  });
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("GREATEST", { varargs: true }, (...args) =>
    args.reduce((a, b) => (a > b ? a : b)),
  );
  sqlite.function("LEAST", { varargs: true }, (...args) => args.reduce((a, b) => (a < b ? a : b)));
  sqlite.function("minutes_between", (a, b) =>
    Math.trunc((Date.parse(b + "Z") - Date.parse(a + "Z")) / 60000),
  );
  sqlite.exec(`
    CREATE TABLE reservations (id TEXT, store_id TEXT, customer_id TEXT, reservation_status TEXT, start_date TEXT, end_date TEXT, total_amount REAL, subtotal_amount REAL, deposit_amount REAL);
    CREATE TABLE reservation_items (id TEXT, reservation_id TEXT, product_id TEXT, quantity INTEGER, total_price REAL);
    CREATE TABLE payments (id TEXT, reservation_id TEXT, amount REAL, payment_status TEXT, payment_type TEXT, payment_method TEXT, paid_at TEXT, created_at TEXT, refund_of_payment_id TEXT, stripe_refund_id TEXT, stripe_payment_intent_id TEXT, stripe_checkout_session_id TEXT);
    CREATE TABLE products (id TEXT, store_id TEXT, name TEXT, quantity INTEGER, track_units INTEGER, product_status TEXT, stock_kind TEXT);
    CREATE TABLE product_units (product_id TEXT, lifecycle_status TEXT);
    CREATE TABLE customers (id TEXT, first_name TEXT, last_name TEXT, company_name TEXT, customer_type TEXT);
    INSERT INTO customers VALUES ('customer', 'Test', 'Customer', NULL, 'individual');
    INSERT INTO reservations VALUES ('r', 'store', 'customer', 'confirmed', '2026-09-10 00:00:00', '2026-09-11 00:00:00', 291, 291, 100),
      ('foreign', 'other-store', 'customer', 'confirmed', '2026-09-10 00:00:00', '2026-09-11 00:00:00', 1000, 1000, 0);
    INSERT INTO products VALUES ('bike', 'store', 'Bike', 1, 0, 'active', 'returnable'), ('free', 'store', 'Free', 1, 0, 'active', 'returnable');
    INSERT INTO reservation_items VALUES ('a','r','bike',1,200), ('b','r','bike',1,35), ('c','r','free',1,0), ('d','r',NULL,1,28), ('e','r','deleted',1,28);
  `);
  const db = drizzle(async (sql, params) => {
    const statement = sqlite.prepare(sql.replaceAll("TIMESTAMPDIFF(MINUTE,", "minutes_between("));
    statement.setReturnArrays(true);
    const args = params.map((value) =>
      value instanceof Date ? formatInTimeZone(value, "UTC", "yyyy-MM-dd HH:mm:ss.SSS") : value,
    );
    return { rows: statement.all(...args) };
  });
  const quantity = orm.sql`CASE WHEN ${schema.products.trackUnits} THEN (SELECT COUNT(*) FROM ${schema.productUnits} WHERE ${schema.productUnits.productId}=${schema.products.id} AND ${schema.productUnits.lifecycleStatus}='active') ELSE ${schema.products.quantity} END`;
  const queries = {
    ...loadQueries("./queries.ts", db),
    ...loadQueries("./rental-queries.ts", db, { effectiveProductQuantitySql: () => quantity }),
  };
  const pay = (
    id,
    amount,
    date,
    {
      status = "completed",
      type = "rental",
      reservation = "r",
      refund = null,
      paidAt = true,
      stripeRefund = null,
      stripeIntent = null,
      stripeSession = null,
    } = {},
  ) => {
    const timestamp = formatInTimeZone(date, "UTC", "yyyy-MM-dd HH:mm:ss.SSS");
    sqlite
      .prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        reservation,
        amount,
        status,
        type,
        "card",
        paidAt ? timestamp : null,
        timestamp,
        refund,
        stripeRefund,
        stripeIntent,
        stripeSession,
      );
  };
  return { sqlite, queries, pay };
}
const now = new Date("2026-09-06T12:00:00Z");

test("all five periods reconcile headline, chart, methods and catalog plus excluded items", async () => {
  for (const period of ["7d", "30d", "90d", "6m", "12m"]) {
    const f = fixture();
    try {
      const window = windowUtils.getSalesWindow(period, now, "Europe/Paris");
      f.pay("at-start", 70.05, window.start);
      f.pay("last", 220.95, new Date(now.getTime() - 1), { paidAt: false });
      f.pay("before", 10, new Date(window.start.getTime() - 1));
      f.pay("at-end", 100, now);
      f.pay("future", 100, new Date(now.getTime() + 1));
      f.pay("pending", 200, window.start, { status: "pending" });
      f.pay("deposit", 100, window.start, { type: "deposit" });
      f.pay("refund", 20, window.start, { refund: "at-start" });
      f.pay("other-store", 1000, window.start, { reservation: "foreign" });
      const [headline, chart, methods, products, customers] = await Promise.all([
        f.queries.getSalesPaymentStats("store", window),
        f.queries.getRevenueTimeSeries("store", window, enUS),
        f.queries.getRevenueByPaymentMethod("store", window),
        f.queries.getTopProductsByRevenue("store", window),
        f.queries.getTopCustomersByRevenue("store", window),
      ]);
      assert.equal(headline.periodRevenue, 291, period);
      assert.equal(headline.periodPaymentCount, 2);
      assert.equal(
        chart.reduce((sum, row) => sum + row.revenue, 0),
        291,
      );
      assert.equal(
        chart.reduce((sum, row) => sum + row.payments, 0),
        2,
      );
      assert.equal(
        methods.reduce((sum, row) => sum + row.amount, 0),
        291,
      );
      assert.equal(products.catalogRevenue, 235);
      assert.equal(products.nonCatalogRevenue, 56);
      assert.equal(products.unallocatedRevenue, 0);
      assert.equal(products.totalRevenue, 291);
      assert.equal(Number(products.products.find((p) => p.productId === "free").totalRevenue), 0);
      assert.equal(
        Number(products.products.find((p) => p.productId === "bike").reservationCount),
        1,
      );
      assert.equal(Number(customers[0].totalRevenue), 291);
      assert.equal(chart.length, window.buckets.length);
    } finally {
      f.sqlite.close();
    }
  }
});

test("receipts without usable item totals remain explicitly unallocated", async () => {
  const f = fixture();
  try {
    const window = windowUtils.getSalesWindow("30d", now);
    f.sqlite.exec("DELETE FROM reservation_items");
    f.pay("payment", 40, window.start);
    let result = await f.queries.getTopProductsByRevenue("store", window);
    assert.equal(result.totalRevenue, 40);
    assert.equal(result.unallocatedRevenue, 40);
    assert.equal(result.products.length, 0);
    f.sqlite.exec("INSERT INTO reservation_items VALUES ('zero','r','free',1,0)");
    result = await f.queries.getTopProductsByRevenue("store", window);
    assert.equal(result.unallocatedRevenue, 40);
    assert.equal(result.catalogRevenue, 0);
  } finally {
    f.sqlite.close();
  }
});

test("upcoming balances subtract payments, restore manual refunds and ignore deposits, future receipts and overpayments", async () => {
  const f = fixture();
  try {
    f.pay("deposit", 100, new Date("2026-09-01"), { type: "deposit" });
    f.pay("paid", 200, new Date("2026-09-01"));
    f.pay("refund", 20, new Date("2026-09-02"), { refund: "paid" });
    f.pay("future", 91, new Date("2026-09-08"));
    let result = await f.queries.getUpcomingRevenue("store", now);
    assert.equal(result.revenue, 111);
    assert.equal(result.reservationCount, 1);
    f.pay("overpayment", 500, new Date("2026-09-03"));
    result = await f.queries.getUpcomingRevenue("store", now);
    assert.equal(result.revenue, 0);
    assert.equal(result.reservationCount, 0);
    f.sqlite.exec("DELETE FROM payments; UPDATE reservations SET total_amount=391 WHERE id='r'");
    f.pay("paid", 200, new Date("2026-09-01"));
    result = await f.queries.getUpcomingRevenue("store", now);
    assert.equal(result.revenue, 91, "legacy total includes a 100 euro deposit");
  } finally {
    f.sqlite.close();
  }
});

test("a Stripe refund row is never a receipt, while the netted charge it refunds still is", async () => {
  const f = fixture();
  try {
    const window = windowUtils.getSalesWindow("30d", now);
    // Partial refund as the webhook records it: the charge is brought down to its net
    // amount and the refund gets its own positive row carrying only the refund id.
    f.pay("charge", 70, window.start, { stripeIntent: "pi_1", stripeSession: "cs_1" });
    f.pay("refund-row", 30, window.start, { stripeRefund: "re_1" });
    // Full refund: the charge leaves the receipts through its status.
    f.pay("refunded-charge", 0, window.start, { status: "refunded", stripeIntent: "pi_2" });
    f.pay("full-refund-row", 50, window.start, { stripeRefund: "re_2" });
    // Older webhooks stamped the refund id on the netted charge itself: still a receipt.
    f.pay("legacy-charge", 40, window.start, { stripeRefund: "re_3", stripeIntent: "pi_3" });
    const [headline, chart, methods, products, customers] = await Promise.all([
      f.queries.getSalesPaymentStats("store", window),
      f.queries.getRevenueTimeSeries("store", window, enUS),
      f.queries.getRevenueByPaymentMethod("store", window),
      f.queries.getTopProductsByRevenue("store", window),
      f.queries.getTopCustomersByRevenue("store", window),
    ]);
    assert.equal(headline.periodRevenue, 110);
    assert.equal(headline.periodPaymentCount, 2);
    assert.equal(headline.totalRevenue, 110);
    assert.equal(
      chart.reduce((sum, row) => sum + row.revenue, 0),
      110,
    );
    assert.equal(
      methods.reduce((sum, row) => sum + row.amount, 0),
      110,
    );
    assert.equal(products.totalRevenue, 110);
    assert.equal(Number(customers[0].totalRevenue), 110);
  } finally {
    f.sqlite.close();
  }
});

test("upcoming balances do not count a Stripe refund row as money paid", async () => {
  const f = fixture();
  try {
    // 200 paid by card then 30 refunded through Stripe: 170 kept out of 291.
    f.pay("charge", 170, new Date("2026-09-01"), { stripeIntent: "pi_1" });
    f.pay("refund-row", 30, new Date("2026-09-02"), { stripeRefund: "re_1" });
    const result = await f.queries.getUpcomingRevenue("store", now);
    assert.equal(result.revenue, 121);
    assert.equal(result.reservationCount, 1);
  } finally {
    f.sqlite.close();
  }
});

test("occupancy uses only active returnable products and effective tracked stock", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`DELETE FROM reservation_items; DELETE FROM products;
      UPDATE reservations SET start_date='2026-09-05 00:00:00',end_date='2026-09-06 00:00:00',reservation_status='completed' WHERE id='r';
      INSERT INTO products VALUES ('tracked','store','Bike',99,1,'active','returnable'),('archived','store','Old',50,0,'archived','returnable'),('service','store','Service',50,0,'active','untracked'),('sale','store','Sale',50,0,'active','consumable');
      INSERT INTO product_units VALUES ('tracked','active'),('tracked','active'),('tracked','retired');
      INSERT INTO reservation_items VALUES ('a','r','tracked',1,10),('b','r','archived',1,10),('c','r',NULL,100,10),('d','r','service',100,10),('e','r','sale',100,10);`);
    const window = windowUtils.getSalesWindow("7d", new Date("2026-09-06T00:00:00Z"));
    const result = await f.queries.getOccupancyStats("store", window);
    assert.equal(result.availableUnits, 2);
    assert.ok(Math.abs(result.rate - 100 / 12) < 0.00001, JSON.stringify(result));
  } finally {
    f.sqlite.close();
  }
});

test("windows use store midnight, cover DST exactly and compare contiguous equal durations", () => {
  for (const timezone of ["UTC", "Europe/Paris", "America/New_York"]) {
    for (const time of ["2026-03-30T12:00:00Z", "2026-10-26T12:00:00Z"]) {
      const window = windowUtils.getSalesWindow("7d", new Date(time), timezone);
      assert.equal(formatInTimeZone(window.start, timezone, "HH:mm"), "00:00");
      assert.equal(+window.previousEnd, +window.start);
      assert.equal(+window.end - +window.start, +window.previousEnd - +window.previousStart);
      assert.equal(window.buckets.length, 7);
      window.buckets.forEach((b, i) =>
        assert.equal(+b.end, i === 6 ? +window.end : +window.buckets[i + 1].start),
      );
    }
  }
  assert.equal(windowUtils.getSalesGrowth(100, 0), null);
  assert.equal(windowUtils.getSalesGrowth(0, 0), 0);
});

test("fractional allocations conserve every cent, including products outside the top ten", () => {
  const shares = windowUtils.allocateSalesAmounts([1 / 3, 1 / 3, 1 / 3, 0], 1);
  assert.deepEqual(shares, [0.34, 0.33, 0.33, 0]);
  const many = windowUtils.allocateSalesAmounts(Array(13).fill(0.005), 0.07);
  assert.equal(Math.round(many.reduce((sum, value) => sum + value, 0) * 100), 7);
  assert.ok(many.every((value) => value >= 0));
});

test("top ten plus other products reconcile rounded receipts with many fractional shares", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("DELETE FROM reservation_items; DELETE FROM products");
    for (let i = 0; i < 13; i++) {
      f.sqlite
        .prepare("INSERT INTO products VALUES (?, 'store', ?, 1, 0, 'active', 'returnable')")
        .run(`p${i}`, `Product ${i}`);
      f.sqlite
        .prepare("INSERT INTO reservation_items VALUES (?, 'r', ?, 1, 1)")
        .run(`i${i}`, `p${i}`);
    }
    const window = windowUtils.getSalesWindow("30d", now);
    f.pay("small", 0.07, window.start);
    const result = await f.queries.getTopProductsByRevenue("store", window);
    assert.equal(result.products.length, 10);
    assert.equal(result.productCount, 13);
    assert.equal(result.catalogRevenue, 0.07);
    assert.equal(result.unallocatedRevenue, 0);
    const topSum = windowUtils.roundSalesAmount(
      result.products.reduce((s, p) => s + Number(p.totalRevenue), 0),
    );
    assert.ok(topSum <= result.catalogRevenue);
  } finally {
    f.sqlite.close();
  }
});

test("midnight keeps the current empty bucket and invalid timezones fall back to UTC", () => {
  const midnight = windowUtils.getSalesWindow("7d", new Date("2026-09-06T00:00:00Z"), "UTC");
  assert.equal(midnight.buckets.length, 7);
  assert.equal(+midnight.buckets[6].start, +midnight.buckets[6].end);
  assert.equal(windowUtils.getSalesWindow("30d", now, "Invalid/Timezone").timezone, "UTC");
});

test("whole payment-method percentages sum to 100", () => {
  const amounts = [11423.54, 2433.9, 693.59, 131.5];
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const shares = windowUtils.allocateSalesAmounts(
    amounts.map((value) => value / total),
    1,
  );
  assert.equal(
    shares.reduce((sum, value) => sum + Math.round(value * 100), 0),
    100,
  );
});

test("empty receipts produce zeros and a complete empty chart", async () => {
  const f = fixture();
  try {
    const window = windowUtils.getSalesWindow("30d", now);
    const stats = await f.queries.getSalesPaymentStats("store", window);
    assert.equal(stats.periodRevenue, 0);
    assert.equal(stats.avgPaymentValue, 0);
    assert.equal(stats.revenueGrowth, 0);
    const chart = await f.queries.getRevenueTimeSeries("store", window, enUS);
    assert.equal(chart.length, 30);
    assert.ok(chart.every((row) => row.revenue === 0 && row.payments === 0));
    const products = await f.queries.getTopProductsByRevenue("store", window);
    assert.equal(products.totalRevenue, 0);
    assert.equal(products.productCount, 0);
    assert.equal(products.unallocatedRevenue, 0);
  } finally {
    f.sqlite.close();
  }
});
