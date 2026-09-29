import assert from "node:assert/strict";
import { test } from "node:test";
import { locales } from "@/i18n/config";
import { createDemoPeriod, type DemoBooking } from "./fixtures";
import { createDemoReservationPages, getDemoCustomer, getDemoToday } from "./reservations";
import {
  acceptDemoPortalQuote,
  createDemoPortal,
  createDemoPortalDetail,
  createDemoPortalEmail,
  createDemoPortalList,
} from "./portal";

const period = createDemoPeriod();
const booking: DemoBooking = { productIndex: 0, quantity: 2, selected: {}, unitPrice: 20, period };

for (const locale of locales) {
  test(`portal keeps planning rows, totals and customer identity in ${locale}`, () => {
    const source = createDemoReservationPages(period, booking, locale, true);
    const portal = createDemoPortal(period, booking, locale);
    assert.deepEqual(
      portal.reservations.map(({ status }) => status),
      ["confirmed", "quote", "completed"],
    );
    assert.ok(portal.completed.end < getDemoToday(period));
    for (const reservation of portal.reservations) {
      const row = source.rows.find(({ id }) => id === reservation.id);
      assert.ok(row);
      assert.equal(reservation.number, row.number);
      assert.equal(reservation.total, Number(row.totalAmount));
      assert.equal(reservation.deposit, Number(row.depositAmount));
      assert.equal(
        reservation.items.reduce((sum, item) => sum + item.totalPrice, 0),
        reservation.total,
      );
      assert.deepEqual(
        reservation.items.map(({ name }) => name),
        row.items.map(({ productSnapshot }) => productSnapshot.name),
      );
      assert.deepEqual(reservation.customer, getDemoCustomer(0));
      const detail = createDemoPortalDetail(reservation, locale);
      const [list] = createDemoPortalList([reservation], locale);
      assert.equal(detail.number, list.number);
      assert.equal(detail.items.total, list.totalAmount);
      assert.equal(detail.periodLabel, list.periodLabel);
      const email = createDemoPortalEmail(reservation, locale);
      assert.equal(email.totalAmount, list.totalAmount);
      assert.equal(email.customerFirstName, reservation.customer.firstName);
      assert.equal(email.currency, "EUR");
    }
    const paid = createDemoPortalDetail(portal.confirmed, locale);
    assert.equal(paid.deposit?.deposit.kind, "held");
    assert.equal(
      paid.payments.payments.find(({ type }) => type === "deposit_hold")?.status,
      "authorized",
    );
    assert.equal(paid.items.amountPaid, portal.confirmed.total);
    assert.equal(paid.invoices.invoices[0]?.amount, portal.confirmed.total);
    const quote = createDemoPortalDetail(portal.quote, locale);
    assert.deepEqual(quote.payments.payments, []);
    assert.deepEqual(quote.invoices.invoices, []);
    assert.equal(quote.actions.actions.required, "quote");
  });
}

test("accepting a quote validates its contract without inventing a payment or signature", () => {
  const { quote } = createDemoPortal(period, booking, "fr");
  const accepted = acceptDemoPortalQuote(quote);
  assert.equal(quote.status, "quote");
  assert.equal(accepted.status, "confirmed");
  assert.equal(accepted.contractValidated, true);
  assert.equal(accepted.paid, false);
  assert.equal(accepted.total, quote.total);
  const detail = createDemoPortalDetail(accepted, "fr");
  assert.equal(detail.actions.actions.required, "payment");
  assert.equal(detail.actions.actions.canPay, true);
  assert.equal(detail.actions.actions.canSign, false);
  assert.equal(detail.actions.actions.canDownloadContract, true);
  assert.deepEqual(detail.payments.payments, []);
  assert.deepEqual(detail.invoices.invoices, []);
  assert.equal(acceptDemoPortalQuote(accepted), accepted);
});
