import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as dateFns from "date-fns";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { stripTypeScriptTypes } from "node:module";
import * as paymentReceipts from "@louez/db/payment-receipts";
import * as schema from "@louez/db/schema";
// Execute the revenue queries against fixtures without server auth or a live DB.
const source = readFileSync(new URL("./queries.ts", import.meta.url), "utf8");
const revenueQueries = source.slice(
  source.indexOf("export interface ProductRevenueStats"),
  source.indexOf("// 2. Reservation counts by status"),
);
const compiled = stripTypeScriptTypes(revenueQueries.replaceAll("export ", ""));

test("product receipts use line totals, payment periods and store isolation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE reservations (id TEXT, store_id TEXT);
      CREATE TABLE reservation_items (reservation_id TEXT, product_id TEXT, total_price REAL);
      CREATE TABLE payments (reservation_id TEXT, amount REAL, payment_status TEXT, payment_type TEXT, paid_at TEXT, created_at TEXT, refund_of_payment_id TEXT, stripe_refund_id TEXT, stripe_payment_intent_id TEXT, stripe_checkout_session_id TEXT);
      INSERT INTO reservations VALUES ('booking', 'store'), ('foreign', 'other-store'), ('free', 'store');
      INSERT INTO reservation_items VALUES
        ('booking', 'free-product', 0), ('booking', 'bags', 28), ('booking', 'insurance', 28),
        ('booking', 'bike', 200), ('booking', 'bike', 35),
        ('foreign', 'bike', 1000), ('free', 'free-product', 0);
    `);
    const db = drizzle(async (query, params) => {
      const statement = sqlite.prepare(query);
      statement.setReturnArrays(true);
      const rows = statement.all(
        ...params.map((value) =>
          Object.prototype.toString.call(value) === "[object Date]"
            ? dateFns.format(value, "yyyy-MM-dd HH:mm:ss")
            : value,
        ),
      );
      // MySQL returns DECIMAL aggregates as strings.
      return {
        rows: rows.map((row) =>
          Object.values(row).map((value, index) => (index === 0 ? String(value) : value)),
        ),
      };
    });
    const getStats = runInNewContext(`${compiled}; getProductRevenueStats`, {
      ...orm,
      ...dateFns,
      ...schema,
      ...paymentReceipts,
      db,
    });
    const stats = (productId) => getStats({ storeId: "store", productId });
    const addPayment = (
      amount,
      daysAgo = 1,
      status = "completed",
      type = "rental",
      reservationId = "booking",
      paidAt = true,
    ) => {
      const date = dateFns.format(dateFns.subDays(new Date(), daysAgo), "yyyy-MM-dd HH:mm:ss");
      sqlite
        .prepare(
          "INSERT INTO payments (reservation_id,amount,payment_status,payment_type,paid_at,created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(reservationId, amount, status, type, paidAt ? date : null, date);
    };
    addPayment(70.05);
    addPayment(220.95);
    // Rows that give money back are never receipts: a manual refund points at the row it
    // refunds, a Stripe refund carries only its refund id.
    sqlite.exec(`INSERT INTO payments VALUES
      ('booking', 50, 'completed', 'rental', '2026-09-01', '2026-09-01', 'original-payment', NULL, NULL, NULL),
      ('booking', 30, 'completed', 'rental', '2026-09-01', '2026-09-01', NULL, 're_1', NULL, NULL)`);
    for (const [productId, expected] of [
      ["free-product", 0],
      ["bags", 28],
      ["insurance", 28],
      ["bike", 235],
    ]) {
      const result = await stats(productId);
      assert.ok(Math.abs(result.allTimeRevenue - expected) < 0.00001);
      assert.equal(result.reservationCount, 1);
    }
    sqlite.exec("DELETE FROM payments");
    addPayment(145.5, 2);
    addPayment(72.75, 40, "completed", "rental", "booking", false);
    addPayment(72.75, 70);
    const partial = await stats("bike");
    assert.equal(partial.last30DaysRevenue, 117.5);
    assert.equal(partial.previous30DaysRevenue, 58.75);
    assert.equal(partial.allTimeRevenue, 235);
    assert.equal(partial.revenueGrowth, 100);
    sqlite.exec("DELETE FROM payments");
    addPayment(291, 1, "pending");
    addPayment(550, 1, "completed", "deposit");
    addPayment(1000, 1, "completed", "rental", "foreign");
    addPayment(10, 1, "completed", "rental", "free");
    for (const productId of ["bike", "free-product", "missing"]) {
      const result = await stats(productId);
      assert.equal(result.allTimeRevenue, 0);
      assert.equal(result.last30DaysRevenue, 0);
      assert.equal(result.revenueGrowth, 0);
    }
  } finally {
    sqlite.close();
  }
});
