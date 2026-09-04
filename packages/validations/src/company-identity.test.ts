import assert from "node:assert/strict";
import { test } from "node:test";

import {
  digitsOnly,
  isPlausibleVatNumber,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
} from "./company-identity";

test("normalizes and validates French invoice identifiers", () => {
  assert.equal(digitsOnly("123 456 789"), "123456789");
  assert.equal(resolveCompanyNumberScheme("FR"), "fr_siren");
  assert.equal(isValidCompanyNumber("FR", "123 456 789"), true);
  assert.equal(isValidCompanyNumber("FR", "123"), false);
  assert.equal(isPlausibleVatNumber("FR", "fr12 123456789"), true);
  assert.equal(isPlausibleVatNumber("FR", "123456789"), false);
});
