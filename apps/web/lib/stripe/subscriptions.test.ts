import assert from "node:assert/strict";
import { test } from "node:test";

import { checkOffSessionCustomer, platformCustomerStoreId } from "./subscriptions";

// The customer check before an off-session platform charge (louez-billing docs/api,
// README §8.4 and §9): the service's `billing_store_id` names the store, or Louez's own
// `storeId` on a customer the service has not adopted.

const card = { invoice_settings: { default_payment_method: "pm_card" } };

test("billing_store_id names the store; Louez's storeId only without it", () => {
  assert.equal(
    platformCustomerStoreId({ id: "cus_1", metadata: { billing_store_id: "a", storeId: "b" } }),
    "a",
  );
  assert.equal(platformCustomerStoreId({ id: "cus_1", metadata: { storeId: "b" } }), "b");
  assert.equal(platformCustomerStoreId({ id: "cus_1", metadata: { billing_store_id: "" } }), null);
  assert.equal(platformCustomerStoreId({ id: "cus_1" }), null);
});

test("an off-session charge uses only a live customer of this store with a card", () => {
  assert.deepEqual(
    checkOffSessionCustomer({ id: "cus_1", metadata: { storeId: "store" }, ...card }, "store"),
    { ok: true, customerId: "cus_1" },
  );
  assert.deepEqual(
    checkOffSessionCustomer(
      { id: "cus_1", metadata: { storeId: "store" }, default_source: "src_1" },
      "store",
    ),
    { ok: true, customerId: "cus_1" },
  );
  // An adopted customer keeps the storeId Louez set: the service's key decides.
  assert.deepEqual(
    checkOffSessionCustomer(
      { id: "cus_1", metadata: { billing_store_id: "other", storeId: "store" }, ...card },
      "store",
    ),
    { ok: false, reason: "other_store" },
  );
  assert.deepEqual(checkOffSessionCustomer({ id: "cus_1", ...card }, "store"), {
    ok: false,
    reason: "other_store",
  });
  assert.deepEqual(
    checkOffSessionCustomer({ id: "cus_1", metadata: { storeId: "store" } }, "store"),
    { ok: false, reason: "no_payment_method" },
  );
  assert.deepEqual(checkOffSessionCustomer({ id: "cus_1", deleted: true }, "store"), {
    ok: false,
    reason: "deleted",
  });
});
