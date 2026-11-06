import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getCustomerContactChannel, hasCustomerContact, hasCustomerEmail } from "./customer-contact";

describe("getCustomerContactChannel", () => {
  test("e-mail first, SMS as a fallback only where the message has an SMS version", () => {
    assert.equal(getCustomerContactChannel({ email: "a@b.fr", phone: "+33612345678" }, { smsAvailable: true }), "email");
    assert.equal(getCustomerContactChannel({ email: null, phone: "+33612345678" }, { smsAvailable: true }), "sms");
    assert.equal(getCustomerContactChannel({ email: null, phone: "+33612345678" }, { smsAvailable: false }), null);
    assert.equal(getCustomerContactChannel({ email: " ", phone: null }, { smsAvailable: true }), null);
  });
});

describe("contact guards", () => {
  test("a blank e-mail is no e-mail, and one contact is enough", () => {
    assert.equal(hasCustomerEmail({ email: "a@b.fr" }), true);
    assert.equal(hasCustomerEmail({ email: "  " }), false);
    assert.equal(hasCustomerEmail({ email: null }), false);
    assert.equal(hasCustomerContact({ email: null, phone: "+33612345678" }), true);
    assert.equal(hasCustomerContact({ email: "", phone: "" }), false);
    assert.equal(hasCustomerContact({}), false);
  });
});
