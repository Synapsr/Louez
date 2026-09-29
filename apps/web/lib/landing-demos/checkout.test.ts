import assert from "node:assert/strict";
import test from "node:test";
import { calculateTotalDeliveryFee } from "@/lib/utils/geo";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { locales } from "@/i18n/config";
import { createCheckoutValidator } from "@/app/(storefront)/[slug]/checkout/validator.checkout";
import {
  CHECKOUT_DEMO_ADDRESSES,
  CHECKOUT_DEMO_ADDRESS_SOURCE,
  CHECKOUT_DEMO_DELIVERY,
  CHECKOUT_DEMO_STORE,
  getDemoCheckout,
  getDemoCheckoutSummary,
  resolveDemoCheckoutDistance,
} from "@/lib/landing-demos/checkout";
import { demo as payment } from "@/components/landing-demos/features/checkout-payment.demo";
import { demo as delivery } from "@/components/landing-demos/features/checkout-delivery.demo";

test("checkout and paid outcome keep the same two bikes, customer, period and amounts in every locale", () => {
  const period = createDemoPeriod();
  for (const locale of locales) {
    const { cart, values, paidReservation } = getDemoCheckout(period, locale);
    const summary = getDemoCheckoutSummary(cart);
    assert.equal(cart.summary.count, 2);
    assert.equal(cart.items.length, 2);
    assert.equal(paidReservation.items.total, summary.totals.amountDueNow);
    assert.equal(paidReservation.items.amountPaid, summary.totals.total);
    assert.equal(paidReservation.items.deposit, summary.totalDeposit);
    assert.equal(summary.totals.amountDueNow, cart.summary.subtotal);
    assert.equal(summary.totals.remainingAmount, 0);
    assert.deepEqual(paidReservation.outcome, { event: "paid", paymentStatus: "paid" });
    assert.equal(paidReservation.statusCard.customerEmail, values.email);
    assert.equal(paidReservation.returnDateRequest.startDate, period.start.toISOString());
    assert.equal(summary.globalEndDate, period.end.toISOString());
    assert.deepEqual(
      paidReservation.items.items.map((item) => item.name),
      cart.items.map((item) => item.productName),
    );
    assert.equal(paidReservation.payments.payments[0].amount, summary.totals.amountDueNow);
    assert.equal(paidReservation.payments.payments[1].type, "deposit_hold");
    assert.equal(paidReservation.payments.payments[1].amount, summary.totalDeposit);
    assert.equal(summary.taxSettings?.displayMode, "inclusive");
  }
});

test("the returning customer's local checkout cannot submit before accepting the real terms", () => {
  const { values } = getDemoCheckout(createDemoPeriod(), "fr");
  const validator = createCheckoutValidator((key) => key, { requireAddress: true, country: "FR" });
  const unchecked = validator.safeParse(values);
  assert.equal(unchecked.success, false);
  if (!unchecked.success)
    assert.deepEqual(
      unchecked.error.issues.map((issue) => issue.path),
      [["acceptCgv"]],
    );
  assert.equal(validator.safeParse({ ...values, acceptCgv: true }).success, true);
});

test("local address search resolves supplied suggestions and rejects unknown input without a fallback", async () => {
  assert.deepEqual(await CHECKOUT_DEMO_ADDRESS_SOURCE.search("24"), []);
  const suggestions = await CHECKOUT_DEMO_ADDRESS_SOURCE.search("24 rue du Moulin");
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].placeId, "demo-checkout-carquefou");
  const address = await CHECKOUT_DEMO_ADDRESS_SOURCE.resolve(suggestions[0].placeId);
  assert.deepEqual(address, CHECKOUT_DEMO_ADDRESSES[0]);
  assert.deepEqual(
    await CHECKOUT_DEMO_ADDRESS_SOURCE.resolve(CHECKOUT_DEMO_ADDRESSES[0].formattedAddress),
    address,
  );
  assert.equal(await CHECKOUT_DEMO_ADDRESS_SOURCE.resolve("unknown"), null);
  assert.deepEqual(await CHECKOUT_DEMO_ADDRESS_SOURCE.search("unknown"), []);
  assert.equal((await CHECKOUT_DEMO_ADDRESS_SOURCE.search("reze")).length, 1);
});

test("local distance uses kilometers and product fees charge each selected delivery leg", () => {
  const address = CHECKOUT_DEMO_ADDRESSES[0];
  const distance = resolveDemoCheckoutDistance({
    originLatitude: CHECKOUT_DEMO_STORE.latitude,
    originLongitude: CHECKOUT_DEMO_STORE.longitude,
    destinationLatitude: address.latitude,
    destinationLongitude: address.longitude,
  });
  assert.ok(distance > 10 && distance < 12);
  const cart = getDemoCheckout(createDemoPeriod(), "fr").cart;
  const outbound = calculateTotalDeliveryFee(
    distance,
    null,
    CHECKOUT_DEMO_DELIVERY,
    cart.summary.subtotal,
  );
  const both = calculateTotalDeliveryFee(
    distance,
    distance,
    CHECKOUT_DEMO_DELIVERY,
    cart.summary.subtotal,
  );
  assert.equal(outbound.outboundFee, Math.round(distance * 1.5 * 100) / 100);
  assert.equal(outbound.returnFee, 0);
  assert.equal(both.returnFee, outbound.outboundFee);
  assert.equal(both.totalFee, Math.round(outbound.totalFee * 2 * 100) / 100);
  const summary = getDemoCheckoutSummary(cart, both.totalFee, true, true);
  assert.equal(summary.deliveryFee, both.totalFee);
  assert.equal(
    summary.totals.amountDueNow,
    Math.round((cart.summary.subtotal + both.totalFee) * 100) / 100,
  );
});

test("both scripts move before acting and leave time for addresses and paid results", () => {
  for (const demo of [payment, delivery]) {
    assert.equal(demo.actor, "customer");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-/);
      assert.doesNotMatch(cue.selector, /aria-label/);
      if (index > 0) assert.ok(cue.at > demo.cues[index - 1].at);
      if (!cue.click && !cue.hover && !cue.type && !cue.emit && !cue.press) continue;
      const move = demo.cues[index - 1];
      assert.ok(move);
      assert.equal(move.selector, cue.selector);
      assert.ok(!move.click && !move.hover && !move.type && !move.emit && !move.press);
      assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
    }
  }
  const typed = delivery.cues.find((cue) => cue.type);
  const suggestion = delivery.cues.find((cue) => cue.selector.includes("data-address-suggestion"));
  assert.ok(typed?.type && suggestion);
  assert.ok(suggestion.at > typed.at + typed.type.duration + 300);
  const outcome = payment.cues.find((cue) => cue.emit === "checkout-payment-paid");
  assert.ok(outcome);
  assert.ok(payment.duration - outcome.at >= 2500);
});
