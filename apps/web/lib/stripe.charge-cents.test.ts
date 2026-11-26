import assert from "node:assert/strict";
import { test } from "node:test";

// What a rental charge takes at Stripe (`toStripeChargeCents`): the checkout's first
// charge, the customer's payment session, the store's payment request and the
// extension all charge through it. The module loads @louez/db: a closed port keeps
// any query away from a real database.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";

test("a rental charge is rounded down to the currency's minor unit, never up", async () => {
  const { toStripeChargeCents, toStripeCents } = await import("./stripe");

  // ¥100.60 owed charges ¥100: rounded as a price, it would be ¥101.
  assert.equal(toStripeChargeCents(100.6, "JPY"), 100);
  assert.equal(toStripeCents(100.6, "JPY"), 101);
  assert.equal(toStripeChargeCents(100.99, "krw"), 100);
  // A two-decimal amount is charged to the cent, as stored.
  assert.equal(toStripeChargeCents(21.29, "EUR"), 2129);
  assert.equal(toStripeChargeCents(0.29, "USD"), 29);
});
