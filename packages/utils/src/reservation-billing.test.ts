import assert from "node:assert/strict";
import { test } from "node:test";

import {
  billingFromCustomer,
  isBusinessBilling,
  resolveReservationBilling,
} from "./reservation-billing";

const businessProfile = {
  customerType: "business" as const,
  companyName: "LUMY",
  companyNumber: "123456789",
  companyNumberScheme: "fr_siren" as const,
  vatNumber: "FR12123456789",
};

test("the booking snapshot wins over the current profile", () => {
  const billing = resolveReservationBilling(
    {
      billingSnapshot: {
        customerType: "individual",
        companyName: null,
        companyNumber: null,
        companyNumberScheme: null,
        vatNumber: null,
      },
    },
    businessProfile,
  );
  assert.equal(billing.customerType, "individual");
  assert.equal(billing.companyName, null);
  assert.equal(isBusinessBilling(billing), false);
});

test("legacy rows without a snapshot read the profile", () => {
  const billing = resolveReservationBilling({ billingSnapshot: null }, businessProfile);
  assert.deepEqual(billing, businessProfile);
  assert.equal(isBusinessBilling(billing), true);
});

test("an individual profile never leaks a stale company", () => {
  const billing = billingFromCustomer({ ...businessProfile, customerType: "individual" });
  assert.equal(billing.customerType, "individual");
  assert.equal(billing.companyName, null);
  assert.equal(billing.vatNumber, null);
});

test("a business billing without a company name is not shown as a business", () => {
  assert.equal(isBusinessBilling({ ...businessProfile, companyName: null }), false);
});
