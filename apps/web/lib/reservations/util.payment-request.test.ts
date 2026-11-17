import assert from "node:assert/strict";
import { test } from "node:test";

import { paymentRequestDelivery, paymentRequestTerms } from "./util.payment-request";
import { getRentalRemaining, getReservationRentalAmount } from "./util.rental-amount";

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

test("the rental costs its stored total, which never contains the deposit", () => {
  const amount = (totalAmount: string) => getReservationRentalAmount({ totalAmount });

  assert.equal(amount("200.00"), 200);
  assert.equal(amount("230.00"), 230);
  // A discount that covers the rental: zero is a valid total, never the subtotal.
  assert.equal(amount("0.00"), 0);
  // A negative or unreadable value owes nothing.
  assert.equal(amount("-5.00"), 0);
  assert.equal(amount("not a number"), 0);
});

// 100.00 before tax at 20 %: a total of 120.00 tax included, a deposit of 20.00,
// on a row as old as the totals that once held their deposit.
const taxedOnTop = {
  currency: "EUR",
  subtotalAmount: "100.00",
  depositAmount: "20.00",
  totalAmount: "120.00",
  createdAt: new Date("2026-02-01T00:00:00Z"),
  taxDisplayMode: null,
};

test("what is owed is the total less the rental paid: the tax is never taken for the deposit", () => {
  assert.equal(getRentalRemaining(taxedOnTop, 100), 20);
  const terms = paymentRequestTerms({
    type: "rental",
    reservation: {
      ...taxedOnTop,
      payments: [{ type: "rental", status: "completed", amount: "100.00" }],
    },
    storeSettings: null,
  });
  assert.deepEqual(terms, { ok: true, amount: 20, description: "Rental", currency: "EUR" });
});

test("a rental whose discount covers it asks nothing", () => {
  // A rental of 20.00 with 20.00 off: a total of zero.
  const covered = {
    currency: "EUR",
    subtotalAmount: "20.00",
    discountAmount: "20.00",
    depositAmount: "0.00",
    totalAmount: "0.00",
    payments: [],
  };
  const terms = paymentRequestTerms({ type: "rental", reservation: covered, storeSettings: null });
  assert.deepEqual(terms, { ok: false, error: "errors.noAmountDue" });
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
      depositAmount: "0.00",
      totalAmount: "0.57",
      payments: [{ type: "rental", status: "completed", amount: "0.07", currency: "EUR" }],
    },
    storeSettings: { currency: "EUR" },
  });
  assert.equal(terms.ok, true);
  assert.equal(terms.ok && terms.amount.toFixed(2), "0.50");
});

test("the success screen says, of each channel chosen, whether the server sent it", () => {
  const email = { email: true, sms: false };
  const both = { email: true, sms: true };
  assert.deepEqual(paymentRequestDelivery(email, { email: true }), {
    state: "sent",
    sent: "email",
  });
  assert.deepEqual(paymentRequestDelivery({ email: false, sms: true }, { sms: true }), {
    state: "sent",
    sent: "sms",
  });
  assert.deepEqual(paymentRequestDelivery(both, { email: true, sms: true }), {
    state: "sent",
    sent: "both",
  });
  assert.deepEqual(paymentRequestDelivery(both, { email: false, sms: true }), {
    state: "partly_sent",
    sent: "sms",
    failed: "email",
  });
  assert.deepEqual(paymentRequestDelivery(both, { email: true, sms: false }), {
    state: "partly_sent",
    sent: "email",
    failed: "sms",
  });
});

test("nothing sent says so: an e-mail the instance could not send, or a channel the server never tried", () => {
  const email = { email: true, sms: false };
  const both = { email: true, sms: true };
  // No e-mail service: the server answers that the e-mail did not go.
  assert.deepEqual(paymentRequestDelivery(email, { email: false }), {
    state: "not_sent",
    failed: "email",
  });
  assert.deepEqual(paymentRequestDelivery(both, { email: false, sms: false }), {
    state: "not_sent",
    failed: "both",
  });
  // An SMS chosen for a customer without a phone is never tried.
  assert.deepEqual(paymentRequestDelivery({ email: false, sms: true }, {}), {
    state: "not_sent",
    failed: "sms",
  });
  // An answer that says nothing of the channels claims nothing.
  assert.deepEqual(paymentRequestDelivery(email, undefined), {
    state: "not_sent",
    failed: "email",
  });
});
