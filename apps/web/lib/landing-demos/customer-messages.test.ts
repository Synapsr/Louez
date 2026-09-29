import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { render } from "@react-email/render";
import { locales } from "@/i18n/config";
import { getDemoCart } from "@/lib/landing-demos/cart";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import {
  createDemoConfirmationProps,
  createDemoEmailContext,
  createDemoNotificationSettings,
} from "@/lib/landing-demos/customer-messages";
import { composeConfirmationPreview } from "@/lib/document-previews/compose-confirmation-preview";
import { createInertEmailDocument } from "@/lib/document-previews/util.inert-email-document";
import { buildManualReservationEmailFromContext } from "@/lib/email/manual-reservation-email-core";
import { getEmailTranslations, getLocaleFromCountry } from "@/lib/email/i18n";

test("the confirmation preview uses the same HTML in the browser renderer", async () => {
  const require = createRequire(import.meta.url);
  const browserPath = require
    .resolve("@react-email/render")
    .replace("/dist/node/", "/dist/browser/")
    .replace(/\.js$/, ".mjs");
  const browserRenderer: { render: typeof render } = await import(pathToFileURL(browserPath).href);
  const period = createDemoPeriod();
  const cart = getDemoCart({ "demo-city-bike": 1 }, period, "fr");
  assert.ok(cart.booking);
  const { element } = composeConfirmationPreview(
    createDemoConfirmationProps(cart.booking, period, "fr"),
  );
  assert.equal(await browserRenderer.render(element), await render(element));
});

test("cart products, rolling dates, rental and deposit follow into both email fixtures", () => {
  const period = createDemoPeriod();
  period.end.setDate(period.end.getDate() + 2);
  const cart = getDemoCart({ "demo-city-bike": 2, "demo-electric-bike": 1 }, period, "fr");
  assert.ok(cart.booking);
  const confirmation = createDemoConfirmationProps(cart.booking, period, "fr");
  const reminder = createDemoEmailContext(cart.booking, period, "fr");
  assert.equal(confirmation.startDate, period.start);
  assert.equal(confirmation.endDate, period.end);
  assert.equal(reminder.reservation.startDate, period.start.toISOString());
  assert.equal(reminder.reservation.endDate, period.end.toISOString());
  assert.deepEqual(
    confirmation.items.map((item) => item.quantity),
    [2, 1],
  );
  assert.equal(confirmation.subtotal, cart.summary.total);
  assert.equal(confirmation.deposit, cart.summary.deposit);
  assert.equal(confirmation.total, cart.summary.total + cart.summary.deposit);
  assert.equal(Number(reminder.reservation.totalAmount), cart.summary.total);
  assert.equal(Number(reminder.reservation.depositAmount), cart.summary.deposit);
  assert.equal(
    confirmation.items.reduce((sum, item) => sum + item.totalPrice, 0),
    confirmation.subtotal,
  );
  assert.deepEqual(
    reminder.reservation.items.map((item) => item.name),
    confirmation.items.map((item) => item.name),
  );
});

test("settings fixtures reset independently and enable the pickup SMS switch locally", () => {
  const first = createDemoNotificationSettings("fr");
  const second = createDemoNotificationSettings("fr");
  assert.equal(first.customerSettings.customer_reminder_pickup.sms, false);
  assert.equal(first.smsQuota.allowed, true);
  first.customerSettings.customer_reminder_pickup.sms = true;
  first.settings.reservation_new.email = false;
  assert.equal(second.customerSettings.customer_reminder_pickup.sms, false);
  assert.equal(second.settings.reservation_new.email, true);
});

test("the real confirmation and reminder templates render in all eight locales without external images or live links", async () => {
  const period = createDemoPeriod();
  for (const locale of locales) {
    const cart = getDemoCart({ "demo-city-bike": 1 }, period, locale);
    assert.ok(cart.booking);
    const props = createDemoConfirmationProps(cart.booking, period, locale);
    const confirmation = composeConfirmationPreview(props);
    assert.equal(
      confirmation.subject,
      `${getEmailTranslations(locale).confirmReservation.subject.replace("{number}", props.reservationNumber)} - Maison du Vélo`,
    );
    const context = createDemoEmailContext(cart.booking, period, locale);
    assert.equal(getLocaleFromCountry(context.store.settings?.country), locale);
    assert.equal(context.store.settings?.timezone, "Europe/Paris");
    assert.match(context.store.address ?? "", /Nantes/);
    const reminder = await buildManualReservationEmailFromContext(context, {
      templateId: "reminder_pickup",
    });
    assert.ok(!("error" in reminder));
    for (const html of [await render(confirmation.element), reminder.html]) {
      const inert = createInertEmailDocument(html);
      assert.match(inert, /Maison du Vélo/);
      assert.doesNotMatch(inert, /<img\b|<script\b|<iframe\b/i);
      assert.doesNotMatch(inert, /<a\b[^>]*\bhref=/i);
      assert.match(inert, /default-src 'none'/);
      assert.match(inert, /aria-disabled="true"/);
    }
  }
});
