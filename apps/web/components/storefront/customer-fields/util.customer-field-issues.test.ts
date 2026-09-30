import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCustomerFieldValueIssues,
  readCustomerFieldIssues,
  readReservationItemDetailIssues,
} from "./util.customer-field-issues";

const idNumber = {
  id: "id-number",
  type: "text" as const,
  format: null,
  options: null,
  collectMode: "required" as const,
};
const size = {
  id: "size",
  type: "select" as const,
  format: null,
  options: ["S", "M"],
  collectMode: "optional" as const,
};

describe("getCustomerFieldValueIssues", () => {
  it("refuses what the server refuses", () => {
    assert.deepEqual(
      getCustomerFieldValueIssues([idNumber, size], { "id-number": "", size: "XL" }),
      [
        { definitionId: "id-number", code: "required" },
        { definitionId: "size", code: "invalidOption" },
      ],
    );
  });

  it("lets an optional field be cleared", () => {
    assert.deepEqual(
      getCustomerFieldValueIssues([idNumber, size], { "id-number": "X", size: "" }),
      [],
    );
  });
});

describe("reading server issues", () => {
  it("reads `data.issues` of a refusal and nothing else", () => {
    const error = {
      message: "errors.customFieldsInvalid",
      data: { issues: [{ definitionId: "size", code: "invalidOption" }] },
    };
    assert.deepEqual(readCustomerFieldIssues(error), [
      { definitionId: "size", code: "invalidOption" },
    ]);
    assert.deepEqual(readCustomerFieldIssues(new Error("errors.generic")), []);
    assert.deepEqual(readCustomerFieldIssues({ data: { issues: [{ definitionId: 1 }] } }), []);
  });

  it("reads reservation unit issues with their item and unit", () => {
    const error = {
      data: {
        issues: [
          { reservationItemId: "item-1", unitIndex: 1, definitionId: "height", code: "required" },
        ],
      },
    };
    assert.deepEqual(readReservationItemDetailIssues(error), [
      { reservationItemId: "item-1", unitIndex: 1, definitionId: "height", code: "required" },
    ]);
    assert.deepEqual(readReservationItemDetailIssues(null), []);
  });
});
