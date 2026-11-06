import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getCustomerMessageChannel,
  getManualTemplateMessage,
  isManualMessageTemplate,
  resolveNotificationDelivery,
} from "./util.customer-message-channel";

const withEmail = { email: "anne@example.test", phone: "+33612345678" };
const phoneOnly = { email: null, phone: "+33612345678" };
const unreachable = { email: null, phone: null };

describe("getCustomerMessageChannel", () => {
  test("a customer with an e-mail is always written to by e-mail", () => {
    assert.equal(
      getCustomerMessageChannel("access_link", withEmail, { smsConfigured: false }),
      "email",
    );
    assert.equal(
      getCustomerMessageChannel("customer_payment_requested", withEmail, { smsConfigured: true }),
      "email",
    );
  });

  test("a phone-only customer gets the SMS version where one exists", () => {
    for (const message of [
      "customer_payment_requested",
      "customer_deposit_authorization_requested",
      "customer_reservation_confirmed",
      "customer_reminder_pickup",
      "customer_reminder_return",
      "custom",
      "review_request",
    ] as const) {
      assert.equal(getCustomerMessageChannel(message, phoneOnly, { smsConfigured: true }), "sms");
    }
  });

  test("e-mail-only messages cannot reach a phone-only customer", () => {
    for (const message of [
      "access_link",
      "contract",
      "customer_quote_sent",
      "manual_payment_request",
      "reservation_modified",
      "payment_confirmation",
    ] as const) {
      assert.equal(getCustomerMessageChannel(message, phoneOnly, { smsConfigured: true }), null);
    }
  });

  test("without SMS set up, or without any contact, nothing goes out", () => {
    assert.equal(getCustomerMessageChannel("custom", phoneOnly, { smsConfigured: false }), null);
    assert.equal(getCustomerMessageChannel("custom", unreachable, { smsConfigured: true }), null);
  });

  test("manual templates map onto their message", () => {
    assert.equal(isManualMessageTemplate("reminder_pickup"), true);
    assert.equal(isManualMessageTemplate("invoice"), false);
    assert.equal(getManualTemplateMessage("reminder_pickup"), "customer_reminder_pickup");
    assert.equal(
      getCustomerMessageChannel(getManualTemplateMessage("payment_request"), phoneOnly, {
        smsConfigured: true,
      }),
      null,
    );
  });
});

describe("resolveNotificationDelivery", () => {
  const base = {
    message: "customer_reminder_pickup",
    channels: { email: true, sms: false },
    smsAllowed: true,
    smsConfigured: true,
  } as const;

  test("keeps the store's channels when the customer has an e-mail", () => {
    assert.deepEqual(resolveNotificationDelivery({ ...base, customer: withEmail }), {
      email: true,
      sms: false,
      smsFallback: false,
    });
    assert.deepEqual(
      resolveNotificationDelivery({
        ...base,
        channels: { email: true, sms: true },
        customer: withEmail,
      }),
      { email: true, sms: true, smsFallback: false },
    );
  });

  test("replaces the e-mail by the SMS version for a phone-only customer", () => {
    assert.deepEqual(resolveNotificationDelivery({ ...base, customer: phoneOnly }), {
      email: false,
      sms: true,
      smsFallback: true,
    });
  });

  test("never doubles an SMS the store already sends", () => {
    assert.deepEqual(
      resolveNotificationDelivery({
        ...base,
        channels: { email: true, sms: true },
        customer: phoneOnly,
      }),
      { email: false, sms: true, smsFallback: false },
    );
  });

  test("skips when the e-mail was not wanted, SMS is refused, missing or unset", () => {
    const skipped = { email: false, sms: false, smsFallback: false };
    assert.deepEqual(
      resolveNotificationDelivery({
        ...base,
        channels: { email: false, sms: false },
        customer: phoneOnly,
      }),
      skipped,
    );
    assert.deepEqual(
      resolveNotificationDelivery({ ...base, smsAllowed: false, customer: phoneOnly }),
      skipped,
    );
    assert.deepEqual(
      resolveNotificationDelivery({ ...base, smsConfigured: false, customer: phoneOnly }),
      skipped,
    );
    assert.deepEqual(resolveNotificationDelivery({ ...base, customer: unreachable }), skipped);
    assert.deepEqual(
      resolveNotificationDelivery({
        ...base,
        message: "customer_quote_sent",
        customer: phoneOnly,
      }),
      skipped,
    );
  });
});
