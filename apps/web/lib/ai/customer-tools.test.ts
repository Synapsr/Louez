import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Lives with the app rather than next to the service: `@louez/api` is an ESM
// package, and its named imports from `@louez/validations` only resolve under
// the CommonJS scope `node --test` gets here.
import {
  checkCustomerFieldEntries,
  resolveCustomerCompanyFields,
  toReadableCustomerFields,
} from "@louez/api/services/customer-tools";
import type { CustomerFieldDefinition } from "@louez/types";

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
  showOnContract: false,
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

const definitions = [
  definition({
    id: "def_cpf",
    key: "br_cpf_cnpj",
    label: "CPF / CNPJ",
    format: "br_cpf_cnpj",
    isSensitive: true,
  }),
  definition({ id: "def_rg", key: "br_rg", label: "RG" }),
  definition({ id: "def_height", key: "height", label: "Taille", type: "number", unit: "cm" }),
  definition({
    id: "def_level",
    key: "ski_level",
    label: "Niveau de ski",
    type: "select",
    options: ["Débutant", "Confirmé"],
  }),
  definition({ id: "def_boat", key: "boat_licence", label: "Permis bateau", type: "checkbox" }),
  definition({ id: "def_po", key: "po_ref", label: "Bon de commande", appliesTo: "business" }),
  definition({ id: "def_old", key: "old", label: "Ancien champ", isActive: false }),
];

describe("checkCustomerFieldEntries", () => {
  test("resolves a field by label, by key, and loosely, whatever the case", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [
        { field: "cpf / cnpj", value: "529.982.247-25" },
        { field: "BR_RG", value: "12.345.678-9" },
        { field: "niveau-de-ski", value: "Confirmé" },
      ],
      customerType: "individual",
      partial: true,
    });

    assert.deepEqual(result, {
      ok: true,
      values: { def_cpf: "52998224725", def_rg: "12.345.678-9", def_level: "Confirmé" },
    });
  });

  test("an unknown field is refused and the available ones are listed", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [{ field: "Pointure", value: "42" }],
      customerType: "individual",
      partial: true,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /Unknown custom field "Pointure"/);
    assert.match(result.ok ? "" : result.error, /CPF \/ CNPJ, RG, Taille/);
    assert.doesNotMatch(result.ok ? "" : result.error, /Ancien champ/);
  });

  test("an archived field cannot be written", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [{ field: "Ancien champ", value: "x" }],
      customerType: "individual",
      partial: true,
    });

    assert.equal(result.ok, false);
  });

  test("invalid values come back as readable errors", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [
        { field: "Taille", value: "grand" },
        { field: "Niveau de ski", value: "Expert" },
      ],
      customerType: "individual",
      partial: true,
    });

    assert.deepEqual(result, {
      ok: false,
      error: '"Taille" must be a number. "Niveau de ski" must be one of: Débutant, Confirmé.',
    });
  });

  test("a field of the other customer type is refused rather than dropped", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [{ field: "Bon de commande", value: "PO-7" }],
      customerType: "individual",
      partial: true,
    });

    assert.deepEqual(result, {
      ok: false,
      error: '"Bon de commande" only applies to business customers.',
    });
  });

  test("an ambiguous name asks for a key", () => {
    const result = checkCustomerFieldEntries({
      definitions: [
        definition({ id: "a", key: "licence_car", label: "Permis" }),
        definition({ id: "b", key: "licence_boat", label: "permis" }),
      ],
      entries: [{ field: "Permis", value: "AB123" }],
      customerType: "individual",
      partial: true,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /licence_car, licence_boat/);
  });

  test("a creation enforces required fields, an update only checks what it carries", () => {
    const required = [definition({ id: "def_doc", label: "Pièce d'identité", isRequired: true })];

    assert.deepEqual(
      checkCustomerFieldEntries({
        definitions: required,
        entries: undefined,
        customerType: "individual",
        partial: false,
      }),
      { ok: false, error: '"Pièce d\'identité" is required.' },
    );
    assert.deepEqual(
      checkCustomerFieldEntries({
        definitions: required,
        entries: undefined,
        customerType: "individual",
        partial: true,
      }),
      { ok: true, values: {} },
    );
    assert.deepEqual(
      checkCustomerFieldEntries({
        definitions: required,
        entries: [{ field: "Pièce d'identité", value: "" }],
        customerType: "individual",
        partial: true,
      }),
      { ok: false, error: '"Pièce d\'identité" is required.' },
    );
  });

  test("an empty value clears an optional field, and a checkbox takes true or false", () => {
    const result = checkCustomerFieldEntries({
      definitions,
      entries: [
        { field: "RG", value: "" },
        { field: "Permis bateau", value: "false" },
      ],
      customerType: "individual",
      partial: true,
    });

    assert.deepEqual(result, { ok: true, values: { def_rg: "", def_boat: "" } });
  });
});

describe("toReadableCustomerFields", () => {
  test("sensitive values are withheld, and said to be", () => {
    const result = toReadableCustomerFields(definitions, {
      def_cpf: "52998224725",
      def_rg: "12.345.678-9",
      def_height: "182",
      def_boat: "true",
      def_old: "x",
    });

    assert.deepEqual(result, {
      fields: { RG: "12.345.678-9", Taille: "182 cm", "Permis bateau": "true" },
      withheld: ["CPF / CNPJ"],
    });
    assert.ok(!JSON.stringify(result).includes("52998224725"));
    assert.ok(!JSON.stringify(result).includes("529.982"));
  });

  test("empty values and unticked checkboxes are left out", () => {
    const result = toReadableCustomerFields(definitions, { def_rg: "", def_boat: "false" });

    assert.deepEqual(result, { fields: {}, withheld: [] });
  });

  test("two fields sharing a label stay distinguishable", () => {
    const result = toReadableCustomerFields(
      [
        definition({ id: "a", key: "licence_car", label: "Permis" }),
        definition({ id: "b", key: "licence_boat", label: "Permis" }),
      ],
      { a: "AB1", b: "CD2" },
    );

    assert.deepEqual(result.fields, { Permis: "AB1", "Permis (licence_boat)": "CD2" });
  });
});

describe("resolveCustomerCompanyFields", () => {
  test("the scheme comes from the country and only labels a well-formed number", () => {
    assert.deepEqual(
      resolveCustomerCompanyFields({
        customerType: "business",
        country: "FR",
        companyNumber: "123 456 789",
        vatNumber: "fr12 123456789",
      }),
      { companyNumber: "123456789", companyNumberScheme: "fr_siren", vatNumber: "FR12123456789" },
    );
    assert.deepEqual(
      resolveCustomerCompanyFields({
        customerType: "business",
        country: "FR",
        companyNumber: "12345",
        vatNumber: null,
      }),
      { companyNumber: "12345", companyNumberScheme: null, vatNumber: null },
    );
    assert.deepEqual(
      resolveCustomerCompanyFields({
        customerType: "business",
        country: "BR",
        companyNumber: "11.222.333/0001-81",
        vatNumber: undefined,
      }),
      { companyNumber: "11.222.333/0001-81", companyNumberScheme: null, vatNumber: null },
    );
  });

  test("an individual carries no company identifier", () => {
    assert.deepEqual(
      resolveCustomerCompanyFields({
        customerType: "individual",
        country: "FR",
        companyNumber: "123456789",
        vatNumber: "FR12123456789",
      }),
      { companyNumber: null, companyNumberScheme: null, vatNumber: null },
    );
  });
});
