import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCustomerReminderChannels } from "./util.customer-reminder-preferences";

for (const event of ["customer_reminder_pickup", "customer_reminder_return"] as const) {
  test(`${event}: each customer opt-out blocks its channel`, () => {
    assert.deepEqual(
      resolveCustomerReminderChannels(
        event,
        { email: true, sms: true },
        { emailReminders: false, smsReminders: true },
      ),
      { email: false, sms: true },
    );
    assert.deepEqual(
      resolveCustomerReminderChannels(
        event,
        { email: true, sms: true },
        { emailReminders: true, smsReminders: false },
      ),
      { email: true, sms: false },
    );
    assert.deepEqual(
      resolveCustomerReminderChannels(
        event,
        { email: true, sms: true },
        { emailReminders: false, smsReminders: false },
      ),
      { email: false, sms: false },
    );
  });
  test(`${event}: customer preferences cannot enable a store-disabled channel`, () => {
    assert.deepEqual(
      resolveCustomerReminderChannels(
        event,
        { email: true, sms: false },
        { emailReminders: true, smsReminders: true },
      ),
      { email: true, sms: false },
    );
  });
  test(`${event}: customers without saved preferences retain current delivery`, () => {
    assert.deepEqual(resolveCustomerReminderChannels(event, { email: true, sms: false }, null), {
      email: true,
      sms: false,
    });
  });
}
for (const event of [
  "customer_reservation_confirmed",
  "customer_payment_requested",
  "customer_deposit_authorization_requested",
  "customer_request_rejected",
  "customer_quote_sent",
] as const) {
  test(`${event}: essential messages are unaffected by reminder opt-outs`, () => {
    assert.deepEqual(
      resolveCustomerReminderChannels(
        event,
        { email: true, sms: true },
        { emailReminders: false, smsReminders: false },
      ),
      { email: true, sms: true },
    );
  });
}
