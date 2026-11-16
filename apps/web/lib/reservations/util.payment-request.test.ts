import assert from "node:assert/strict";
import { test } from "node:test";

import { getReservationRentalAmount, paymentRequestTerms } from "./util.payment-request";

const reservation = (currency: string | null = "EUR") => ({
  currency,
  subtotalAmount: "200.00",
  depositAmount: "300.00",
  totalAmount: "200.00",
  payments: [
    { type: "rental", status: "completed", amount: "50.00" },
    // Neither a pending payment nor a deposit pays the rental.
    { type: "rental", status: "pending", amount: "150.00" },
    { type: "deposit", status: "completed", amount: "300.00" },
  ],
});

test("a payment request is in the reservation's currency, not the store's of today", () => {
  // Booked in euros; the store has moved to dollars since.
  const storeSettings = { currency: "USD" };
  for (const type of ["rental", "deposit", "custom"] as const) {
    const terms = paymentRequestTerms({
      type,
      customAmount: "20",
      reservation: reservation("EUR"),
      storeSettings,
    });
    assert.equal(terms.ok && terms.currency, "EUR", type);
  }
});

test("a reservation older than its own currency is requested in the store's", () => {
  const terms = paymentRequestTerms({
    type: "rental",
    reservation: reservation(null),
    storeSettings: { currency: "USD" },
  });
  assert.equal(terms.ok && terms.currency, "USD");
  // Neither has one: the column's default.
  const bare = paymentRequestTerms({
    type: "rental",
    reservation: reservation(null),
    storeSettings: null,
  });
  assert.equal(bare.ok && bare.currency, "EUR");
});

test("the amount is the rental still due, the deposit, or the store's own", () => {
  const storeSettings = { currency: "EUR" };
  const of = (type: "rental" | "deposit" | "custom", customAmount?: string) =>
    paymentRequestTerms({ type, customAmount, reservation: reservation(), storeSettings });

  assert.deepEqual(of("rental"), {
    ok: true,
    amount: 150,
    description: "Rental",
    currency: "EUR",
  });
  assert.deepEqual(of("deposit"), {
    ok: true,
    amount: 300,
    description: "Deposit",
    currency: "EUR",
  });
  assert.deepEqual(of("custom", "12.5"), {
    ok: true,
    amount: 12.5,
    description: "Payment",
    currency: "EUR",
  });
});

test("only what was paid in the reservation's currency reduces the rental still due", () => {
  // Booked in euros. A card payment in dollars, taken while the store was on dollars,
  // is not euros received; a cash payment is in the reservation's currency whatever
  // its row says (older rows kept the column's EUR default).
  const terms = (payments: ReturnType<typeof reservation>["payments"]) =>
    paymentRequestTerms({
      type: "rental",
      reservation: { ...reservation("EUR"), payments },
      storeSettings: { currency: "USD" },
    });
  const paid = (method: string, currency: string | null) => ({
    type: "rental",
    status: "completed",
    amount: "50.00",
    method,
    currency,
  });

  assert.deepEqual(terms([paid("stripe", "USD")]), {
    ok: true,
    amount: 200,
    description: "Rental",
    currency: "EUR",
  });
  for (const counted of [paid("stripe", "EUR"), paid("stripe", null), paid("cash", "USD")]) {
    const due = terms([counted]);
    assert.equal(due.ok && due.amount, 150);
  }
});

test("a refund of the rental is not rental received", () => {
  // 100.00 paid by card, 30.00 of it refunded through Stripe: the charge is at its
  // net 70.00, and the refund row is no payment.
  const terms = paymentRequestTerms({
    type: "rental",
    reservation: {
      ...reservation("EUR"),
      payments: [
        {
          id: "charge",
          type: "rental",
          status: "completed",
          amount: "70.00",
          method: "stripe",
          currency: "EUR",
          stripePaymentIntentId: "pi_1",
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
        },
        {
          id: "refund",
          type: "rental",
          status: "completed",
          amount: "30.00",
          method: "stripe",
          currency: "EUR",
          refundOfPaymentId: "charge",
          stripePaymentIntentId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: "re_1",
        },
      ],
    },
    storeSettings: { currency: "EUR" },
  });

  assert.equal(terms.ok && terms.amount, 130);
});

test("nothing to ask for is refused", () => {
  const storeSettings = { currency: "EUR" };
  const paid = {
    ...reservation(),
    depositAmount: "0.00",
    payments: [{ type: "rental", status: "completed", amount: "200.00" }],
  };

  assert.deepEqual(paymentRequestTerms({ type: "rental", reservation: paid, storeSettings }), {
    ok: false,
    error: "errors.noAmountDue",
  });
  assert.deepEqual(paymentRequestTerms({ type: "deposit", reservation: paid, storeSettings }), {
    ok: false,
    error: "errors.noDepositRequired",
  });
  for (const customAmount of [undefined, "0", "0.49"]) {
    assert.deepEqual(
      paymentRequestTerms({ type: "custom", customAmount, reservation: paid, storeSettings }),
      { ok: false, error: "errors.invalidAmount" },
    );
  }
});

test("the rental amount leaves out a deposit the total includes", () => {
  const amounts = (subtotalAmount: string, depositAmount: string, totalAmount: string) =>
    getReservationRentalAmount({ subtotalAmount, depositAmount, totalAmount });

  assert.equal(amounts("200.00", "300.00", "200.00"), 200);
  assert.equal(amounts("200.00", "300.00", "500.00"), 200);
  assert.equal(amounts("200.00", "0.00", "230.00"), 230);
  assert.equal(amounts("200.00", "0.00", "0.00"), 200);
});

test("a custom amount is judged as typed, in the reservation's currency", () => {
  const terms = (customAmount: string, currency: string) =>
    paymentRequestTerms({
      type: "custom",
      customAmount,
      reservation: reservation(currency),
      storeSettings: { currency: "EUR" },
    });
  // 19.999 is never asked as 20.00; half a yen is no request.
  assert.deepEqual(terms("19.999", "EUR"), { ok: false, error: "errors.amountTooPrecise" });
  assert.deepEqual(terms("0.5", "JPY"), { ok: false, error: "errors.amountTooPrecise" });
  assert.deepEqual(terms("10", "KWD"), {
    ok: false,
    error: "errors.currencyNotSupportedForPayments",
  });
  for (const malformed of ["5e2", "abc", "-20"]) {
    assert.deepEqual(
      terms(malformed, "EUR"),
      { ok: false, error: "errors.invalidAmount" },
      malformed,
    );
  }
  assert.deepEqual(terms("20.00", "EUR"), {
    ok: true,
    amount: 20,
    description: "Payment",
    currency: "EUR",
  });
  assert.deepEqual(terms("1500", "JPY"), {
    ok: true,
    amount: 1500,
    description: "Payment",
    currency: "JPY",
  });
});

test("the rental still due is compared in hundredths: 0.57 less 0.07 paid is fifty cents due", () => {
  const terms = paymentRequestTerms({
    type: "rental",
    reservation: {
      ...reservation("EUR"),
      subtotalAmount: "0.57",
      depositAmount: "0.00",
      totalAmount: "0.57",
      payments: [{ type: "rental", status: "completed", amount: "0.07", currency: "EUR" }],
    },
    storeSettings: { currency: "EUR" },
  });
  assert.equal(terms.ok, true);
  assert.equal(terms.ok && terms.amount.toFixed(2), "0.50");
});
