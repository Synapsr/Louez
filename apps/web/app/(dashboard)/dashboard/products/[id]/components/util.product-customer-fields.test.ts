import assert from "node:assert/strict";
import { test } from "node:test";

import { productCardFields } from "./util.product-customer-fields";

test("a team-only customer field is left out; asked or per-unit fields stay, in order", () => {
  const fields = [
    { id: "cpf", scope: "customer" as const, collectMode: "never" as const },
    { id: "height", scope: "item" as const, collectMode: "never" as const },
    { id: "licence", scope: "customer" as const, collectMode: "required" as const },
    { id: "level", scope: "item" as const, collectMode: "optional" as const },
  ];
  assert.deepEqual(
    productCardFields(fields).map((field) => field.id),
    ["height", "licence", "level"],
  );
});
