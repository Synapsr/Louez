import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReservationBillingSnapshot,
  resolveCustomerCompanyIdentity,
} from "./billing-snapshot";

const businessCheckout = {
  email: "client@example.test",
  firstName: "C",
  lastName: "T",
  customerType: "business" as const,
  companyName: " LUMY ",
  companyNumber: "552 100 554",
  vatNumber: "fr 40 552100554",
};

test("a business checkout freezes the normalized company identity on the reservation", () => {
  const identity = resolveCustomerCompanyIdentity(businessCheckout, "FR");
  assert.ok(identity);
  assert.deepEqual(buildReservationBillingSnapshot(businessCheckout, identity), {
    customerType: "business",
    companyName: "LUMY",
    companyNumber: "552100554",
    companyNumberScheme: "fr_siren",
    vatNumber: "FR40552100554",
  });
});

test("an individual checkout carries no company, whatever the form still holds", () => {
  const checkout = { ...businessCheckout, customerType: "individual" as const };
  const identity = resolveCustomerCompanyIdentity(checkout, "FR");
  assert.ok(identity);
  assert.deepEqual(buildReservationBillingSnapshot(checkout, identity), {
    customerType: "individual",
    companyName: null,
    companyNumber: null,
    companyNumberScheme: null,
    vatNumber: null,
  });
});

test("a checkout without a type is billed as an individual", () => {
  const { customerType: _type, ...checkout } = businessCheckout;
  const identity = resolveCustomerCompanyIdentity(checkout, "FR");
  assert.ok(identity);
  assert.equal(buildReservationBillingSnapshot(checkout, identity).customerType, "individual");
});
