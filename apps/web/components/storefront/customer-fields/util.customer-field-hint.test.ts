import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCustomerFieldHintKind } from "./util.customer-field-hint";

const dni = { helpText: "Ex. : 12345678Z", format: "es_dni_nie" } as const;

describe("getCustomerFieldHintKind", () => {
  it("shows the help text while nothing is wrong", () => {
    assert.equal(getCustomerFieldHintKind(dni, ""), "help");
    assert.equal(getCustomerFieldHintKind(dni, "12345678Z"), "help");
  });

  it("puts a warning in place of the help text when the number looks wrong", () => {
    assert.equal(getCustomerFieldHintKind(dni, "12312321Z"), "warning");
  });

  it("puts the error first", () => {
    assert.equal(getCustomerFieldHintKind(dni, "12312321Z", "Required"), "error");
  });

  it("shows nothing for a field without help text", () => {
    assert.equal(getCustomerFieldHintKind({ helpText: null, format: null }, "x"), null);
  });
});
