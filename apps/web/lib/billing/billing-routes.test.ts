import assert from "node:assert/strict";
import { test } from "node:test";

import {
  billingHandoffHref,
  isBillingHandoffPath,
  isBillingOnlyPath,
  readBillingReturnOrigin,
  readHandoffPage,
} from "./billing-routes";

// The hand-off's routes (louez-billing docs/api, README §10) and the pages it may open
// (openapi `HandoffTokenClaims.to`).

test("the hand-off opens a billing page of the contract, or the overview", () => {
  for (const page of ["/", "/payment-method", "/statements", "/statements/stmt_1", "/details"]) {
    assert.equal(readHandoffPage(page), page);
  }
  for (const value of [
    null,
    undefined,
    "",
    "payment-method",
    "/admin",
    "//evil.test",
    "/details/",
  ]) {
    assert.equal(readHandoffPage(value), "/", String(value));
  }
});

test("its links keep the page in `to`, and the overview needs none", () => {
  assert.equal(billingHandoffHref(), "/dashboard/billing");
  assert.equal(billingHandoffHref("/"), "/dashboard/billing");
  assert.equal(billingHandoffHref("/payment-method"), "/dashboard/billing?to=%2Fpayment-method");
  assert.equal(billingHandoffHref("/elsewhere"), "/dashboard/billing");
  const to = new URL(billingHandoffHref("/statements/stmt_1"), "https://app.test").searchParams;
  assert.equal(to.get("to"), "/statements/stmt_1");
});

test("a link from the onboarding names it in `from`, after the page", () => {
  assert.equal(
    billingHandoffHref("/payment-method", "onboarding"),
    "/dashboard/billing?to=%2Fpayment-method&from=onboarding",
  );
  assert.equal(billingHandoffHref("/", "onboarding"), "/dashboard/billing?from=onboarding");
  assert.equal(billingHandoffHref("/payment-method", null), billingHandoffHref("/payment-method"));
});

test("the return goes back only to an origin Louez knows", () => {
  assert.equal(readBillingReturnOrigin("onboarding"), "onboarding");
  for (const value of [null, undefined, "", "Onboarding", "/onboarding", "settings"]) {
    assert.equal(readBillingReturnOrigin(value), null, String(value));
  }
});

test("the hand-off, the billing settings and the card step exist only with platform billing", () => {
  for (const path of [
    "/dashboard/billing",
    "/dashboard/billing/return",
    "/dashboard/settings/billing",
    "/onboarding/billing",
  ]) {
    assert.ok(isBillingOnlyPath(path), path);
  }
  assert.ok(!isBillingOnlyPath("/dashboard/billingx"));
  assert.ok(!isBillingOnlyPath("/onboarding"));
  assert.ok(!isBillingOnlyPath("/onboarding/branding"));
});

test("only the hand-off itself sends its own security headers, not the return under it", () => {
  assert.ok(isBillingHandoffPath("/dashboard/billing"));
  assert.ok(isBillingHandoffPath("/dashboard/billing/"));
  assert.ok(!isBillingHandoffPath("/dashboard/billing/return"));
  assert.ok(!isBillingHandoffPath("/dashboard/settings/billing"));
});
