import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, mock, test } from "node:test";

import type { ShownDetail } from "./approval-preview";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

let preview: typeof import("./approval-preview");
before(async () => {
  preview = await import("./approval-preview");
});

// What the approval's page shows of a stored preview's details and display,
// without a database: which identifiers it hides, what a group emptied by
// that reads as, and which display texts read at all.

const detailsOf = (details: unknown): ShownDetail[] =>
  preview.shownPreview({ summary: "Record a payment.", details })?.details ?? [];

/** The details as one line of text: each label, then its value, groups in order. */
const flat = (entries: ShownDetail[]): string =>
  entries
    .map(({ label, value }) =>
      [
        label,
        value.kind === "group"
          ? value.entries.length > 0
            ? flat(value.entries)
            : "None"
          : "text" in value
            ? value.text
            : "value" in value
              ? String(value.value)
              : value.kind,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" | ");

describe("an identifier is hidden only when a readable name identifies the same thing", () => {
  test("another thing named in the group does not hide it", () => {
    assert.equal(
      flat(detailsOf({ customerId: "customer_42", productName: "Kayak" })),
      "Customer id customer_42 | Product name Kayak",
    );
  });

  test("a name that shows nothing does not hide it", () => {
    assert.match(flat(detailsOf({ customerId: "customer_42", name: "\u200d" })), /^Customer id customer_42/);
    assert.match(flat(detailsOf({ id: "res_1", number: "\u200d\ufe0f" })), /^Id res_1/);
  });

  test("its own name, number, e-mail, title or label hides it, in camel or snake case", () => {
    for (const namer of ["customerName", "customerNumber", "customerEmail", "customerTitle", "customerLabel"]) {
      assert.doesNotMatch(flat(detailsOf({ customerId: "customer_42", [namer]: "Camille" })), /customer_42/, namer);
    }
    assert.doesNotMatch(flat(detailsOf({ customer_id: "customer_42", customer_name: "Camille" })), /customer_42/);
    assert.match(flat(detailsOf({ customer_id: "customer_42", customerName: "Camille" })), /customer_42/);
    assert.doesNotMatch(flat(detailsOf({ id: "res_1", number: "R-00094" })), /res_1/);
    assert.doesNotMatch(flat(detailsOf({ id: "res_1", number: 1042 })), /res_1/);
  });

  test("a bare name names a bare id only", () => {
    assert.equal(
      flat(detailsOf({ id: "pay_1", customerId: "customer_42", name: "Camille" })),
      "Customer id customer_42 | Name Camille",
    );
  });

  test("an item's own heading names its id, and the id of the thing it was taken from", () => {
    assert.equal(flat(detailsOf({ lines: [{ id: "l_1", name: "Kayak", quantity: 2 }] })), "Lines Kayak Quantity 2");
    assert.equal(
      flat(detailsOf({ lines: [{ productName: "Kayak", productId: "p_1", customerId: "c_1" }] })),
      "Lines Kayak Customer id c_1",
    );
  });

  test("a heading that shows nothing names nothing: the item keeps its identifier", () => {
    const unseen = "\u200d\ufe0f";
    for (const item of [
      { id: "p_1", name: unseen },
      { productId: "p_1", product: unseen },
    ]) {
      const details = { lines: [item] };
      assert.match(flat(detailsOf(details)), /p_1/, JSON.stringify(Object.keys(item)));
    }
    assert.equal(flat(detailsOf({ lines: [{ id: "p_1", name: "K" }] })), "Lines K");
  });

  test("a digest is never shown", () => {
    assert.equal(flat(detailsOf({ recipientsHash: "f".repeat(64), number: "R-1" })), "Number R-1");
  });
});

describe("a group emptied by filtering is not “None”", () => {
  test("an item left with nothing but its heading shows its heading alone", () => {
    assert.equal(flat(detailsOf({ lines: [{ product: "Kayak", productId: "p_1" }] })), "Lines Kayak");
  });

  test("a list whose items all had nothing to show is left out; a list stored empty reads “None”", () => {
    assert.equal(flat(detailsOf({ lines: [{}, null], number: "R-1" })), "Number R-1");
    assert.equal(flat(detailsOf({ messages: [], number: "R-1" })), "Messages None | Number R-1");
    assert.equal(flat(detailsOf({ customer: { id: "c_1", name: "Camille" }, nothing: { productId: null } })), "Customer Name Camille");
  });
});

describe("a display's text value reads as a name does", () => {
  const withCustomer = (customer: string) =>
    preview.shownDisplay({
      headline: { key: "recordPayment", values: {} },
      facts: [
        {
          key: "booking",
          values: { number: { type: "text", text: "R-1" }, customer: { type: "text", text: customer } },
        },
      ],
    });

  test("a name of joiners and variation selectors shows nothing: the request is unreadable", () => {
    for (const nothing of ["\u200d\ufe0f", "\u200d", "\ufe0f\ufe0f", "\u200c\u200d"]) {
      assert.equal(withCustomer(nothing)?.readable, false, JSON.stringify(nothing));
    }
  });

  test("one letter or digit is a name; an emoji with its joiners reads", () => {
    assert.equal(withCustomer("A")?.readable, true);
    assert.equal(withCustomer("7")?.readable, true);
    assert.equal(withCustomer("Ann 👨\u200d👩\u200d👧")?.readable, true);
  });
});
