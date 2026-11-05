import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCustomerFieldDisplayValue,
  getFilledFieldValues,
  hasMissingRequiredValue,
} from "./util.customer-field-display";

const options = { intlLocale: "en-GB", yesLabel: "Yes" };

describe("formatCustomerFieldDisplayValue", () => {
  it("reads each type the way a customer would", () => {
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "number", unit: "cm" }, "80.5", options),
      "80.5 cm",
    );
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "number", unit: null }, "1800", {
        ...options,
        intlLocale: "fr-FR",
      }),
      "1 800",
    );
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "checkbox", unit: null }, "true", options),
      "Yes",
    );
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "date", unit: null }, "2026-03-12", options),
      "12 Mar 2026",
    );
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "select", unit: null }, "M", options),
      "M",
    );
  });

  it("shows nothing for an empty value or an unticked box", () => {
    assert.equal(formatCustomerFieldDisplayValue({ type: "text", unit: null }, "  ", options), "");
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "text", unit: null }, undefined, options),
      "",
    );
    assert.equal(
      formatCustomerFieldDisplayValue({ type: "checkbox", unit: null }, "false", options),
      "",
    );
  });
});

describe("getFilledFieldValues", () => {
  it("keeps the field order and skips empty values", () => {
    const fields = [
      { id: "height", label: "Height", type: "number" as const, unit: "cm" },
      { id: "shoe", label: "Shoe", type: "number" as const, unit: null },
      { id: "pref", label: "Preferences", type: "textarea" as const, unit: null },
    ];
    assert.deepEqual(
      getFilledFieldValues(fields, { pref: "Comfort saddle", height: "172" }, options),
      [
        { id: "height", label: "Height", value: "172 cm" },
        { id: "pref", label: "Preferences", value: "Comfort saddle" },
      ],
    );
  });
});

describe("hasMissingRequiredValue", () => {
  it("flags a required field left empty only", () => {
    const fields = [
      { id: "height", collectMode: "required" as const },
      { id: "pref", collectMode: "optional" as const },
    ];
    assert.equal(hasMissingRequiredValue(fields, { height: "172" }), false);
    assert.equal(hasMissingRequiredValue(fields, { pref: "x" }), true);
    assert.equal(hasMissingRequiredValue(fields, { height: " " }), true);
  });
});
