import assert from "node:assert/strict";
import { test } from "node:test";

import { productPermissions } from "./util.product-permissions";

test("only a member allowed to delete sees the delete actions", () => {
  assert.deepEqual(productPermissions("owner"), { canDelete: true });
  assert.deepEqual(productPermissions("platform_admin"), { canDelete: true });
  assert.deepEqual(productPermissions("member"), { canDelete: false });
});
