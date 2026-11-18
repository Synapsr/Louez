import assert from "node:assert/strict";
import { test } from "node:test";

import { canUseAiVisibility } from "./entitlement";

test("every store gets AI visibility until it is tied to a plan or an add-on", async () => {
  assert.equal(await canUseAiVisibility({ id: "store_000000000000001" }), true);
  assert.equal(await canUseAiVisibility({ id: "store_000000000000002" }), true);
});
