import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  hasSuspiciousIdentityValue,
  normalizeCustomerFieldValue,
  toCustomerFieldSearchValue,
  validateCustomerFieldValues,
} from "./customer-fields";

const field = (overrides: Record<string, unknown>) => ({
  id: "f".repeat(21),
  type: "text" as const,
  format: null,
  options: null,
  isRequired: false,
  appliesTo: "all" as const,
  isActive: true,
  ...overrides,
});

describe("toCustomerFieldSearchValue", () => {
  test("punctuation, case and accents never stand between a search and its match", () => {
    assert.equal(toCustomerFieldSearchValue("529.982.247-25"), "52998224725");
    assert.equal(toCustomerFieldSearchValue(" AB-123 cd "), "ab123cd");
    assert.equal(toCustomerFieldSearchValue("Élodie Müller"), "elodiemuller");
  });
});

describe("normalizeCustomerFieldValue", () => {
  test("each type has one stored form", () => {
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "number" }), " 1 250,5 "), {
      value: "1250.5",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "number" }), "abc"), {
      code: "invalidNumber",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "date" }), "2026-02-30"), {
      code: "invalidDate",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "date" }), "1991-03-14"), {
      value: "1991-03-14",
    });
    assert.deepEqual(
      normalizeCustomerFieldValue(
        field({ type: "select", options: ["Débutant", "Expert"] }),
        "Expert",
      ),
      { value: "Expert" },
    );
    assert.deepEqual(
      normalizeCustomerFieldValue(field({ type: "select", options: ["Débutant"] }), "Pro"),
      { code: "invalidOption" },
    );
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "checkbox" }), "true"), {
      value: "true",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "checkbox" }), "false"), {
      value: "",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "url" }), "louez.io/a"), {
      value: "https://louez.io/a",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "email" }), "A@B.io"), {
      value: "a@b.io",
    });
    assert.deepEqual(normalizeCustomerFieldValue(field({ type: "phone" }), "12"), {
      code: "invalidPhone",
    });
    assert.deepEqual(
      normalizeCustomerFieldValue(field({ format: "br_cpf_cnpj" }), "529.982.247-25"),
      { value: "52998224725" },
    );
    assert.deepEqual(normalizeCustomerFieldValue(field({}), "   "), { value: "" });
  });
});

describe("validateCustomerFieldValues", () => {
  const cpf = field({ id: "a".repeat(21), format: "br_cpf_cnpj", isRequired: true });
  const company = field({ id: "b".repeat(21), appliesTo: "business", isRequired: true });
  const archived = field({ id: "c".repeat(21), isActive: false, isRequired: true });

  test("required fields are enforced only where they apply, archived ones never", () => {
    const result = validateCustomerFieldValues({
      definitions: [cpf, company, archived],
      values: { [cpf.id]: "" },
      customerType: "individual",
    });
    assert.deepEqual(result.issues, [{ definitionId: cpf.id, code: "required" }]);
    assert.deepEqual(result.values, {});
  });

  test("values of unknown fields are dropped, an empty string clears a value", () => {
    const optional = field({ id: "d".repeat(21) });
    const result = validateCustomerFieldValues({
      definitions: [optional],
      values: { [optional.id]: "", unknown: "x" },
      customerType: "individual",
    });
    assert.deepEqual(result, { values: { [optional.id]: "" }, issues: [] });
  });

  test("a partial update only checks what it carries", () => {
    const result = validateCustomerFieldValues({
      definitions: [cpf, field({ id: "e".repeat(21) })],
      values: { ["e".repeat(21)]: "hello" },
      customerType: "individual",
      partial: true,
    });
    assert.deepEqual(result, { values: { ["e".repeat(21)]: "hello" }, issues: [] });
  });
});

describe("hasSuspiciousIdentityValue", () => {
  test("warns on a failed control digit, stays quiet without a format or a value", () => {
    assert.equal(hasSuspiciousIdentityValue("br_cpf_cnpj", "529.982.247-26"), true);
    assert.equal(hasSuspiciousIdentityValue("br_cpf_cnpj", "529.982.247-25"), false);
    assert.equal(hasSuspiciousIdentityValue(null, "anything"), false);
    assert.equal(hasSuspiciousIdentityValue("pt_nif", " "), false);
  });
});
