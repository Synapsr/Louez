import assert from "node:assert/strict";
import { test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

import { getContractCustomerFieldLines } from "./util.contract-customer-fields";

const definition = (
  overrides: Partial<CustomerFieldDefinition> & Pick<CustomerFieldDefinition, "id" | "label">,
): CustomerFieldDefinition => ({
  key: overrides.id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "Identité",
  position: 0,
  width: "half",
  appliesTo: "all",
  isRequired: false,
  isSensitive: false,
  showOnContract: true,
  isSearchable: false,
  showInList: false,
  templateKey: null,
  isActive: true,
  scope: "customer",
  collectMode: "never",
  targetMode: "all",
  customerEditable: false,
  targets: [],
  ...overrides,
});

const options: Parameters<typeof getContractCustomerFieldLines>[2] = {
  customerType: "individual",
  formatDate: (isoDate) => `date(${isoDate})`,
};

test("prints only the fields flagged for the contract that hold a value", () => {
  const lines = getContractCustomerFieldLines(
    [
      definition({ id: "rg", label: "RG" }),
      definition({ id: "hidden", label: "Pointure", showOnContract: false }),
      definition({ id: "empty", label: "Organisme émetteur" }),
      definition({ id: "blank", label: "Permis" }),
      definition({ id: "archived", label: "Ancien champ", isActive: false }),
    ],
    { rg: "12.345.678-9", hidden: "42", blank: "   ", archived: "x" },
    options,
  );

  assert.deepEqual(lines, [{ id: "rg", label: "RG", value: "12.345.678-9" }]);
});

test("prints a sensitive identifier in full, in its readable form", () => {
  const lines = getContractCustomerFieldLines(
    [definition({ id: "cpf", label: "CPF / CNPJ", format: "br_cpf_cnpj", isSensitive: true })],
    { cpf: "52998224725" },
    options,
  );

  assert.deepEqual(lines, [{ id: "cpf", label: "CPF / CNPJ", value: "529.982.247-25" }]);
});

test("appends the unit, formats dates and flattens long text", () => {
  const lines = getContractCustomerFieldLines(
    [
      definition({ id: "height", label: "Taille", type: "number", unit: "cm" }),
      definition({ id: "expiry", label: "Expiration", type: "date" }),
      definition({ id: "notes", label: "Remarques", type: "textarea" }),
      definition({ id: "phone", label: "Contact de secours", type: "phone" }),
    ],
    { height: "182", expiry: "2031-04-09", notes: "Allergie\n  au latex", phone: "+33612345678" },
    options,
  );

  assert.deepEqual(
    lines.map((line) => line.value),
    ["182 cm", "date(2031-04-09)", "Allergie au latex", "+33612345678"],
  );
});

test("a ticked checkbox prints its label alone, an unticked one is skipped", () => {
  const lines = getContractCustomerFieldLines(
    [
      definition({ id: "boat", label: "Permis bateau", type: "checkbox" }),
      definition({ id: "helmet", label: "Casque fourni", type: "checkbox" }),
    ],
    { boat: "true", helmet: "false" },
    options,
  );

  assert.deepEqual(lines, [{ id: "boat", label: "Permis bateau", value: null }]);
});

test("skips fields that do not apply to the customer's type", () => {
  const definitions = [
    definition({ id: "po", label: "Bon de commande", appliesTo: "business" }),
    definition({ id: "licence", label: "Permis", appliesTo: "individual" }),
  ];
  const values = { po: "PO-7", licence: "AB123" };

  assert.deepEqual(
    getContractCustomerFieldLines(definitions, values, options).map((line) => line.id),
    ["licence"],
  );
  assert.deepEqual(
    getContractCustomerFieldLines(definitions, values, {
      ...options,
      customerType: "business",
    }).map((line) => line.id),
    ["po"],
  );
});

test("keeps the definitions' order", () => {
  const lines = getContractCustomerFieldLines(
    [definition({ id: "b", label: "B" }), definition({ id: "a", label: "A" })],
    { a: "1", b: "2" },
    options,
  );

  assert.deepEqual(
    lines.map((line) => line.id),
    ["b", "a"],
  );
});

test("prints a number in the contract's locale, with its unit", () => {
  const french = new Intl.NumberFormat("fr");
  const lines = getContractCustomerFieldLines(
    [definition({ id: "height", label: "Hauteur de selle", type: "number", unit: "cm" })],
    { height: "80.5" },
    { ...options, formatNumber: (value) => french.format(value) },
  );
  assert.deepEqual(lines, [{ id: "height", label: "Hauteur de selle", value: "80,5 cm" }]);
});
