import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStoreCustomerFormLayout } from "@louez/validations";

import { selectQuickCreateItems } from "./util.customer-quick-create";

const custom = (id: string, isRequired: boolean) => ({
  id,
  scope: "customer" as const,
  position: 100,
  width: "half" as const,
  isActive: true,
  appliesTo: "all" as const,
  isRequired,
});

test("keeps identity, contact and required fields, in the store's order", () => {
  const items = resolveStoreCustomerFormLayout({
    settings: null,
    scope: "customer",
    definitions: [custom("licence", true), custom("shoeSize", false)],
  });

  const keys = selectQuickCreateItems(items).map((item) => item.key);

  assert.deepEqual(keys, ["firstName", "lastName", "email", "phone", "companyName", "licence"]);
});
