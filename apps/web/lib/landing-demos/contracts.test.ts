import assert from "node:assert/strict";
import { test } from "node:test";

import { locales } from "@/i18n/config";
import {
  createDemoContractDetail,
  createDemoContractProps,
  createDemoContractSnapshot,
} from "@/lib/landing-demos/contracts";
import { createDemoReservationDetail } from "@/lib/landing-demos/reservation-detail";
import { getDemoProducts } from "@/lib/landing-demos/fixtures";
import fr from "@/messages/fr.json";
import { demo as documentDemo } from "@/components/landing-demos/features/contract-document.demo";
import { demo as contentDemo } from "@/components/landing-demos/features/contract-content.demo";
import { demo as traceDemo } from "@/components/landing-demos/features/contract-trace.demo";

test("contract snapshots use the rolling default booking and keep its financial data", () => {
  const snapshot = createDemoContractSnapshot();
  const period = { start: new Date(snapshot.start), end: new Date(snapshot.end) };
  assert.ok(period.start.getTime() > Date.now());
  assert.equal(period.end.getTime() - period.start.getTime(), 9 * 60 * 60 * 1000);
  const booking = { productIndex: 0, quantity: 2, selected: {}, period, unitPrice: 20 };
  for (const locale of locales) {
    const expected = createDemoReservationDetail(booking, period, 0, "confirmed", locale);
    const { reservation } = createDemoContractDetail(locale, snapshot);
    const props = createDemoContractProps(locale, snapshot, fr.contract);
    assert.equal(props.store.name, "Maison du Vélo");
    assert.equal(props.currency, "EUR");
    assert.equal(props.timezone, "Europe/Paris");
    assert.equal(reservation.number, expected.reservation.number);
    assert.deepEqual(reservation.customer, expected.reservation.customer);
    assert.deepEqual(reservation.items, expected.reservation.items);
    assert.deepEqual(reservation.startDate, period.start);
    assert.deepEqual(reservation.endDate, period.end);
    assert.equal(props.reservation.items[0]?.productSnapshot.name, getDemoProducts(locale)[0].name);
    assert.equal(props.reservation.totalAmount, "40");
    assert.equal(props.reservation.depositAmount, "300");
    assert.equal(props.reservation.subtotalAmount, expected.reservation.subtotalAmount);
  }
});

test("PDF validation uses the reservation confirmation time and has no signature or IP", () => {
  const snapshot = createDemoContractSnapshot();
  const first = createDemoContractDetail("fr", snapshot);
  const second = createDemoContractDetail("fr", snapshot);
  assert.deepEqual(first, second);
  const props = createDemoContractProps("fr", snapshot, fr.contract);
  assert.equal(props.reservation.automaticContractValidation, true);
  assert.equal(props.reservation.signatureIp, null);
  assert.deepEqual(
    props.reservation.signedAt,
    first.reservation.activity.find((item) => item.activityType === "confirmed")?.createdAt,
  );
  assert.deepEqual(props.document.generatedAt, first.reservation.createdAt);
  assert.equal(props.store.logoUrl, null);
  assert.deepEqual(props.reservation.payments, first.reservation.payments);
  assert.equal(props.reservation.payments.length, 2);
  assert.equal(props.reservation.payments[0]?.amount, "40");
  assert.equal(
    first.reservation.payments.find((payment) => payment.type === "deposit_hold")?.amount,
    "300",
  );
});

test("contract cue loops give every action a preceding move and time to read", () => {
  for (const demo of [documentDemo, contentDemo, traceDemo]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at >= 0 && cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-/);
      assert.ok(!cue.selector.includes("aria-label"));
      const previous = demo.cues[index - 1];
      if (previous) assert.ok(cue.at > previous.at);
      if (cue.click || cue.press || cue.scroll || cue.emit) {
        assert.ok(previous);
        assert.equal(previous.selector, cue.selector);
        assert.ok(cue.at - previous.at >= 700 && cue.at - previous.at <= 900);
        assert.equal(previous.click, undefined);
        assert.equal(previous.press, undefined);
        assert.equal(previous.scroll, undefined);
      }
      assert.equal(cue.draw, undefined);
    }
  }
});
