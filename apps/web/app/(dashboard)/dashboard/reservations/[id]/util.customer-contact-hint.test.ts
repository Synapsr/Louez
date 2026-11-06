import assert from "node:assert/strict";
import { test } from "node:test";

import { getCustomerContactHint } from "./util.customer-contact-hint";

test("explains what a customer without e-mail can still receive", () => {
  const phone = "+33612345678";

  assert.equal(
    getCustomerContactHint({ email: "anne@example.test", phone }, { smsConfigured: true }),
    null,
  );
  assert.equal(getCustomerContactHint({ email: null, phone }, { smsConfigured: true }), "smsOnly");
  assert.equal(getCustomerContactHint({ email: " ", phone }, { smsConfigured: false }), "noEmail");
  assert.equal(
    getCustomerContactHint({ email: null, phone: null }, { smsConfigured: true }),
    "noContact",
  );
});
