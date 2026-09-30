import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheckoutFieldIssue, CustomerFieldPublic } from "@louez/validations";

import type { CheckoutFieldsPlan } from "./checkout.types";
import {
  buildCheckoutFieldsPlan,
  getCheckoutFieldIssueName,
  getCheckoutFieldIssues,
  getCheckoutFieldNamesForStep,
  getCheckoutFieldsSubmission,
  hasCheckoutDetailsStep,
  hasEveryCustomerFieldOnFile,
  toUnitKey,
} from "./util.checkout-custom-fields";

const field = (overrides: Partial<CustomerFieldPublic> & { id: string }): CustomerFieldPublic => ({
  label: overrides.id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "Infos",
  position: 0,
  scope: "customer",
  collectMode: "optional",
  isSensitive: false,
  ...overrides,
});

const idNumber = field({ id: "id-number", collectMode: "required", isSensitive: true });
const height = field({
  id: "height",
  type: "number",
  unit: "cm",
  scope: "item",
  collectMode: "required",
});
const notes = field({ id: "notes", type: "textarea", scope: "item" });

const bikeLine = {
  lineId: "line-bike",
  productId: "bike",
  productName: "Fat bike",
  productImage: null,
  quantity: 2,
};
const helmetLine = {
  lineId: "line-helmet",
  productId: "helmet",
  productName: "Casque",
  productImage: null,
  quantity: 1,
};

const plan: CheckoutFieldsPlan = {
  customerFields: [idNumber],
  lines: [
    { ...bikeLine, itemFields: [height, notes] },
    { ...helmetLine, itemFields: [] },
  ],
};

describe("buildCheckoutFieldsPlan", () => {
  it("pairs the answer with the cart lines by position", () => {
    const built = buildCheckoutFieldsPlan(
      {
        customerFields: [idNumber],
        lines: [
          { productId: "bike", quantity: 2, itemFields: [height] },
          { productId: "helmet", quantity: 1, itemFields: [] },
        ],
      },
      [bikeLine, helmetLine],
    );
    assert.deepEqual(
      built.lines.map((line) => [line.lineId, line.itemFields.map((item) => item.id)]),
      [
        ["line-bike", ["height"]],
        ["line-helmet", []],
      ],
    );
    assert.equal(hasCheckoutDetailsStep(built), true);
  });

  it("asks nothing of a line whose answer is for another product (cart changed meanwhile)", () => {
    const built = buildCheckoutFieldsPlan(
      { customerFields: [], lines: [{ productId: "helmet", quantity: 1, itemFields: [height] }] },
      [bikeLine],
    );
    assert.deepEqual(built.lines[0]?.itemFields, []);
    assert.equal(hasCheckoutDetailsStep(built), false);
  });

  it("is empty without an answer", () => {
    assert.deepEqual(buildCheckoutFieldsPlan(undefined, [bikeLine]), {
      customerFields: [],
      lines: [],
    });
  });
});

describe("getCheckoutFieldsSubmission", () => {
  it("sends every asked customer field and every unit of the asking lines", () => {
    const submission = getCheckoutFieldsSubmission(
      {
        customerFields: { "id-number": "AB123", "not-asked": "drop me" },
        itemDetails: {
          [toUnitKey("line-bike", 0)]: {
            participantName: "  Léa ",
            values: { height: "172 ", notes: "" },
          },
          [toUnitKey("line-bike", 5)]: { values: { height: "999" } },
        },
      },
      plan,
    );
    assert.deepEqual(submission.customerFields, { "id-number": "AB123" });
    assert.deepEqual(submission.itemDetails, [
      {
        lineIndex: 0,
        units: [{ participantName: "Léa", values: { height: "172" } }, { values: {} }],
      },
    ]);
  });

  it("keeps a blank customer value so a signed-in customer can clear it", () => {
    const submission = getCheckoutFieldsSubmission({ customerFields: {}, itemDetails: {} }, plan);
    assert.deepEqual(submission.customerFields, { "id-number": "" });
  });
});

describe("getCheckoutFieldIssues", () => {
  it("runs the shared rules and points each issue at its input", () => {
    const issues = getCheckoutFieldIssues(
      {
        customerFields: { "id-number": "" },
        itemDetails: {
          [toUnitKey("line-bike", 0)]: { values: { height: "tall" } },
          [toUnitKey("line-bike", 1)]: { values: { height: "150" } },
        },
      },
      plan,
    );
    assert.deepEqual(issues, [
      { path: ["customerFields", "id-number"], code: "required" },
      { path: ["itemDetails", "line-bike~0", "values", "height"], code: "invalidNumber" },
    ]);
  });

  it("finds nothing when the cart asks nothing", () => {
    assert.deepEqual(
      getCheckoutFieldIssues(
        { customerFields: {}, itemDetails: {} },
        { customerFields: [], lines: [] },
      ),
      [],
    );
  });
});

describe("getCheckoutFieldIssueName", () => {
  const customerIssue: CheckoutFieldIssue = {
    target: "customer",
    definitionId: "id-number",
    code: "required",
  };
  const itemIssue: CheckoutFieldIssue = {
    target: "item",
    lineIndex: 0,
    unitIndex: 1,
    definitionId: "height",
    code: "required",
  };

  it("maps a server issue to the exact input", () => {
    assert.equal(getCheckoutFieldIssueName(customerIssue, plan), "customerFields.id-number");
    assert.equal(
      getCheckoutFieldIssueName(itemIssue, plan),
      "itemDetails.line-bike~1.values.height",
    );
  });

  it("skips fields this checkout does not show (rules changed since the page loaded)", () => {
    assert.equal(
      getCheckoutFieldIssueName({ ...customerIssue, definitionId: "new-field" }, plan),
      null,
    );
    assert.equal(getCheckoutFieldIssueName({ ...itemIssue, lineIndex: 1 }, plan), null);
    assert.equal(getCheckoutFieldIssueName({ ...itemIssue, lineIndex: 7 }, plan), null);
    assert.equal(getCheckoutFieldIssueName({ ...itemIssue, unitIndex: 2 }, plan), null);
  });
});

describe("getCheckoutFieldNamesForStep", () => {
  it("lists the contact step's customer fields and the details step's unit fields", () => {
    assert.deepEqual(getCheckoutFieldNamesForStep(plan, "contact"), ["customerFields.id-number"]);
    assert.deepEqual(getCheckoutFieldNamesForStep(plan, "details"), [
      "itemDetails.line-bike~0.values.height",
      "itemDetails.line-bike~0.values.notes",
      "itemDetails.line-bike~1.values.height",
      "itemDetails.line-bike~1.values.notes",
    ]);
  });
});

describe("hasEveryCustomerFieldOnFile", () => {
  const size = field({ id: "size", type: "select", options: ["S", "M"] });

  it("folds only when every asked value is on file and still valid", () => {
    assert.equal(
      hasEveryCustomerFieldOnFile([idNumber, size], { "id-number": "X1", size: "M" }),
      true,
    );
    assert.equal(hasEveryCustomerFieldOnFile([idNumber, size], { "id-number": "X1" }), false);
    assert.equal(hasEveryCustomerFieldOnFile([size], { size: "XXL" }), false);
    assert.equal(hasEveryCustomerFieldOnFile([], {}), false);
  });
});
