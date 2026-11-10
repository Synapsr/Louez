import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SMS_TEMPLATE_MAX_LENGTH,
  customerNotificationTemplateSchema,
  updateCustomerTemplateInputSchema,
} from "./notifications";
import { reviewBoosterTemplateSchema } from "./review-booster";

const eventType = "customer_reservation_cancelled";

test("a saved SMS text takes at most 480 characters, about three SMS", () => {
  assert.equal(SMS_TEMPLATE_MAX_LENGTH, 480);
  const fits = "a".repeat(SMS_TEMPLATE_MAX_LENGTH);
  const over = `${fits}a`;
  assert.equal(
    updateCustomerTemplateInputSchema.safeParse({ eventType, template: { smsMessage: fits } })
      .success,
    true,
  );
  assert.equal(
    updateCustomerTemplateInputSchema.safeParse({ eventType, template: { smsMessage: over } })
      .success,
    false,
  );
  assert.equal(reviewBoosterTemplateSchema.safeParse({ smsMessage: fits }).success, true);
  assert.equal(reviewBoosterTemplateSchema.safeParse({ smsMessage: over }).success, false);
});

test("a template saved before the bound is still read as it is", () => {
  const long = "a".repeat(SMS_TEMPLATE_MAX_LENGTH + 100);
  assert.equal(customerNotificationTemplateSchema.safeParse({ smsMessage: long }).success, true);
});
