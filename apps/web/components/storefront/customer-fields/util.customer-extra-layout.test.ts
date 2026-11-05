import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { joinCustomerExtraLayout } from "./util.customer-extra-layout";

describe("joinCustomerExtraLayout", () => {
  const birthDate = { key: "birthDate" as const, collectMode: "optional" as const };
  const licence = { id: "licence", label: "Permis" };
  const passport = { id: "passport", label: "Passeport" };

  test("the fields come in the layout's order, native and custom interleaved, with their widths", () => {
    const items = joinCustomerExtraLayout(
      [
        { kind: "custom", key: "passport", width: "half" },
        { kind: "builtin", key: "birthDate", width: "full" },
        { kind: "custom", key: "licence", width: "half" },
      ],
      [birthDate],
      [licence, passport],
    );

    assert.deepEqual(
      items.map((item) => [item.key, item.width]),
      [
        ["passport", "half"],
        ["birthDate", "full"],
        ["licence", "half"],
      ],
    );
    assert.equal(items[1]?.kind === "builtin" && items[1].field, birthDate);
  });

  test("an entry this form does not show is left out", () => {
    const items = joinCustomerExtraLayout(
      [
        { kind: "builtin", key: "socialLinks", width: "full" },
        { kind: "custom", key: "licence", width: "half" },
        { kind: "custom", key: "someone-else", width: "half" },
      ],
      [birthDate],
      [licence],
    );
    assert.deepEqual(
      items.map((item) => item.key),
      ["licence"],
    );
  });
});
