import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomerProfileSchema } from "./validator.customer-profile";
import { toCheckoutInitialCustomer } from "@/app/(storefront)/[slug]/checkout/util.checkout-customer";

const profile = {
  firstName: " Alice ",
  lastName: " Martin ",
  phone: "+33612345678",
  address: "1 rue Exemple",
  city: "Paris",
  postalCode: "75001",
  isBusinessCustomer: false,
  companyName: "",
  companyNumber: "",
  vatNumber: "",
};

test("profile update only accepts editable fields and normalizes identity", () => {
  const value = createCustomerProfileSchema("FR").parse({
    ...profile,
    email: "other@example.test",
    id: "other-customer",
    storeId: "other-store",
    notes: "internal",
  });
  assert.equal(value.firstName, "Alice");
  for (const key of ["email", "id", "storeId", "notes"]) assert.equal(key in value, false);
});

test("profile rejects blank identity, malformed phone and invalid business identifiers", () => {
  const schema = createCustomerProfileSchema("FR");
  for (const patch of [
    { firstName: " " },
    { phone: "abc" },
    { isBusinessCustomer: true },
    { isBusinessCustomer: true, companyName: "Example", companyNumber: "bad" },
  ]) {
    assert.equal(schema.safeParse({ ...profile, ...patch }).success, false);
  }
});

test("saved profile fields are reused by checkout prefill", () => {
  const { isBusinessCustomer, ...fields } = createCustomerProfileSchema("FR").parse(profile);
  const result = toCheckoutInitialCustomer({
    ...fields,
    email: "alice@example.test",
    customerType: isBusinessCustomer ? "business" : "individual",
  });
  assert.equal(result.firstName, "Alice");
  assert.equal(result.phone, profile.phone);
  assert.equal(result.address, profile.address);
  assert.equal(result.city, profile.city);
  assert.equal(result.postalCode, profile.postalCode);
});
