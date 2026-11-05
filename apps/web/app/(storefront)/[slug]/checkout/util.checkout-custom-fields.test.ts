import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheckoutFieldIssue, CustomerFieldPublic } from "@louez/validations";

import { EMPTY_CUSTOMER_PROFILE_FORM_VALUES } from "@/components/storefront/customer-fields/util.customer-profile-fields";

import type { CheckoutFieldsPlan } from "./checkout.types";
import {
  buildCheckoutFieldsPlan,
  getCheckoutFieldIssueName,
  getCheckoutFieldIssues,
  getCheckoutFieldNamesForStep,
  getCheckoutFieldsSubmission,
  hasCheckoutDetailsStep,
  hasEveryAskedValueOnFile,
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
  position: 0,
  width: "half",
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
  profileFields: [],
  customerFields: [idNumber],
  customerLayout: [{ kind: "custom", key: "id-number", width: "half" }],
  lines: [
    { ...bikeLine, itemFields: [height, notes] },
    { ...helmetLine, itemFields: [] },
  ],
};

describe("buildCheckoutFieldsPlan", () => {
  it("pairs the answer with the cart lines by position", () => {
    const built = buildCheckoutFieldsPlan(
      {
        profileFields: [{ key: "birthDate", collectMode: "required" }],
        customerFields: [idNumber],
        customerLayout: [
          { kind: "custom", key: "id-number", width: "half" },
          { kind: "builtin", key: "birthDate", width: "full" },
        ],
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
    assert.deepEqual(built.profileFields, [{ key: "birthDate", collectMode: "required" }]);
    // The contact step's order comes from the owner's layout, as answered.
    assert.deepEqual(
      built.customerLayout.map((item) => item.key),
      ["id-number", "birthDate"],
    );
  });

  it("asks nothing of a line whose answer is for another product (cart changed meanwhile)", () => {
    const built = buildCheckoutFieldsPlan(
      {
        profileFields: [],
        customerFields: [],
        customerLayout: [],
        lines: [{ productId: "helmet", quantity: 1, itemFields: [height] }],
      },
      [bikeLine],
    );
    assert.deepEqual(built.lines[0]?.itemFields, []);
    assert.equal(hasCheckoutDetailsStep(built), false);
  });

  it("is empty without an answer", () => {
    assert.deepEqual(buildCheckoutFieldsPlan(undefined, [bikeLine]), {
      profileFields: [],
      customerFields: [],
      customerLayout: [],
      lines: [],
    });
  });
});

describe("getCheckoutFieldsSubmission", () => {
  it("sends every asked customer field and every unit of the asking lines", () => {
    const submission = getCheckoutFieldsSubmission(
      {
        profileFields: EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
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
    const submission = getCheckoutFieldsSubmission(
      { profileFields: EMPTY_CUSTOMER_PROFILE_FORM_VALUES, customerFields: {}, itemDetails: {} },
      plan,
    );
    assert.deepEqual(submission.customerFields, { "id-number": "" });
  });
});

describe("getCheckoutFieldIssues", () => {
  it("runs the shared rules and points each issue at its input", () => {
    const issues = getCheckoutFieldIssues(
      {
        profileFields: EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
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
        { profileFields: EMPTY_CUSTOMER_PROFILE_FORM_VALUES, customerFields: {}, itemDetails: {} },
        { profileFields: [], customerFields: [], customerLayout: [], lines: [] },
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

describe("native profile fields on the contact step", () => {
  const withProfile: CheckoutFieldsPlan = {
    ...plan,
    profileFields: [
      { key: "birthDate", collectMode: "required" },
      { key: "acquisitionSource", collectMode: "required" },
      { key: "socialLinks", collectMode: "optional" },
    ],
  };
  const profile = (overrides: Partial<typeof EMPTY_CUSTOMER_PROFILE_FORM_VALUES>) => ({
    ...EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
    ...overrides,
  });

  it("checks them before the store's own questions, pointing at their inputs", () => {
    const issues = getCheckoutFieldIssues(
      {
        profileFields: profile({
          birthDate: "2999-01-01",
          socialLinks: { whatsapp: "call me" },
        }),
        customerFields: { "id-number": "X1" },
        itemDetails: {
          [toUnitKey("line-bike", 0)]: { values: { height: "170" } },
          [toUnitKey("line-bike", 1)]: { values: { height: "150" } },
        },
      },
      withProfile,
    );
    assert.deepEqual(issues, [
      { path: ["profileFields", "birthDate"], code: "invalidDate" },
      { path: ["profileFields", "acquisitionSource"], code: "required" },
      { path: ["profileFields", "socialLinks"], code: "invalidPhone" },
    ]);
  });

  it("sends the asked ones; 'Autre' keeps its detail", () => {
    const submission = getCheckoutFieldsSubmission(
      {
        profileFields: profile({
          birthDate: "1990-05-17",
          acquisitionSource: { source: "other", detail: " Salon " },
          socialLinks: { instagram: "@lea", x: "" },
        }),
        customerFields: {},
        itemDetails: {},
      },
      withProfile,
    );
    assert.deepEqual(submission.profileFields, {
      birthDate: "1990-05-17",
      acquisitionSource: "other",
      acquisitionSourceDetail: "Salon",
      socialLinks: { instagram: "@lea" },
    });
  });

  it("validates them with the contact step and maps a server refusal to the input", () => {
    assert.deepEqual(getCheckoutFieldNamesForStep(withProfile, "contact"), [
      "profileFields.birthDate",
      "profileFields.acquisitionSource",
      "profileFields.socialLinks",
      "customerFields.id-number",
    ]);
    const issue: CheckoutFieldIssue = { target: "profile", field: "birthDate", code: "required" };
    assert.equal(getCheckoutFieldIssueName(issue, withProfile), "profileFields.birthDate");
    assert.equal(getCheckoutFieldIssueName(issue, plan), null);
  });

  it("folds only when every asked value, native and custom, is on file", () => {
    const saved = profile({
      birthDate: "1990-05-17",
      acquisitionSource: { source: "ads", detail: "" },
      socialLinks: { instagram: "lea" },
    });
    const params = {
      profileFields: withProfile.profileFields,
      customerFields: [idNumber],
      savedProfile: saved,
      savedValues: { "id-number": "X1" },
    };
    assert.equal(hasEveryAskedValueOnFile(params), true);
    assert.equal(hasEveryAskedValueOnFile({ ...params, savedValues: {} }), false);
    assert.equal(
      hasEveryAskedValueOnFile({ ...params, savedProfile: profile({ ...saved, socialLinks: {} }) }),
      false,
    );
    assert.equal(
      hasEveryAskedValueOnFile({ ...params, customerFields: [], savedValues: {} }),
      true,
    );
    assert.equal(
      hasEveryAskedValueOnFile({ ...params, profileFields: [], customerFields: [] }),
      false,
    );
  });
});
