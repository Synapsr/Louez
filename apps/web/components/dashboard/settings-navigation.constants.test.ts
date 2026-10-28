import assert from "node:assert/strict";
import { test } from "node:test";

import { filterSettingsNavigationItems } from "./settings-navigation.constants";

// The plan, referral and per-store admin pricing pages only exist with platform billing
// (louez-billing docs/plans/design.md §7.2): the settings menu and its search hide them.

const ids = (options: Parameters<typeof filterSettingsNavigationItems>[0]) =>
  filterSettingsNavigationItems(options).map((item) => item.id);

test("billing pages are listed only when the instance bills its stores", () => {
  const off = ids({ billingEnabled: false, electronicInvoicingEnabled: true, isPlatformAdmin: true });
  for (const id of ["subscription", "referrals", "admin"]) assert.ok(!off.includes(id), id);
  assert.ok(off.includes("payments"), "online payments are not platform billing");

  const on = ids({ billingEnabled: true, electronicInvoicingEnabled: true, isPlatformAdmin: true });
  for (const id of ["subscription", "referrals", "admin"]) assert.ok(on.includes(id), id);
  assert.deepEqual(
    on.filter((id) => !off.includes(id)).sort(),
    ["admin", "referrals", "subscription"],
    "nothing else changes",
  );
});

test("the platform-admin and invoicing rules still apply", () => {
  const member = ids({ billingEnabled: true, electronicInvoicingEnabled: false, isPlatformAdmin: false });
  assert.ok(!member.includes("admin"));
  assert.ok(member.includes("subscription"));
});
