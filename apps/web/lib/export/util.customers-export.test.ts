import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCustomersExport, type CustomerExportRow } from "./util.customers-export";

const customer = (overrides: Partial<CustomerExportRow> = {}): CustomerExportRow => ({
  id: "cus_1",
  customerType: "individual",
  firstName: "Thomas",
  lastName: "Lefèvre",
  companyName: null,
  email: "thomas@example.test",
  phone: "+33612345678",
  address: "3 rue du Port",
  postalCode: "56360",
  city: "Le Palais",
  country: "FR",
  birthDate: "1991-03-14",
  acquisitionSource: "partner",
  acquisitionSourceDetail: "Office de tourisme",
  createdVia: "storefront",
  createdAt: new Date("2026-05-02T08:30:00Z"),
  ...overrides,
});

const definitions = [
  { id: "def_cpf", label: "CPF / CNPJ", format: "br_cpf_cnpj", isSensitive: true, isActive: true },
  { id: "def_rg", label: "RG", format: null, isSensitive: false, isActive: true },
  { id: "def_old", label: "Ancien champ", format: null, isSensitive: false, isActive: false },
] satisfies Parameters<typeof buildCustomersExport>[0]["definitions"];

const valuesByCustomer = new Map([
  ["cus_1", { def_cpf: "52998224725", def_rg: "12.345.678-9", def_old: "x" }],
]);

test("sensitive fields are left out unless the export opts in", () => {
  const result = buildCustomersExport({
    customers: [customer()],
    definitions,
    valuesByCustomer,
    includeSensitive: false,
  });

  assert.deepEqual(result.headers.slice(-2), ["Created At", "RG"]);
  assert.ok(!result.headers.includes("CPF / CNPJ"));
  assert.ok(!result.rows[0]?.some((cell) => cell.includes("529")));
  assert.deepEqual(result.json[0]?.customFields, { RG: "12.345.678-9" });
});

test("an opted-in export carries the sensitive column, in its readable form", () => {
  const result = buildCustomersExport({
    customers: [customer()],
    definitions,
    valuesByCustomer,
    includeSensitive: true,
  });

  assert.deepEqual(result.headers.slice(-2), ["CPF / CNPJ", "RG"]);
  assert.deepEqual(result.rows[0]?.slice(-2), ["529.982.247-25", "12.345.678-9"]);
});

test("native columns come first, in a fixed order", () => {
  const result = buildCustomersExport({
    customers: [customer()],
    definitions: [],
    valuesByCustomer: new Map(),
    includeSensitive: false,
  });

  assert.deepEqual(result.headers, [
    "Type",
    "First Name",
    "Last Name",
    "Company",
    "Email",
    "Phone",
    "Address",
    "Postal Code",
    "City",
    "Country",
    "Birth Date",
    "Source",
    "Channel",
    "Created At",
  ]);
  assert.deepEqual(result.rows[0], [
    "individual",
    "Thomas",
    "Lefèvre",
    "",
    "thomas@example.test",
    "+33612345678",
    "3 rue du Port",
    "56360",
    "Le Palais",
    "FR",
    "1991-03-14",
    "partner: Office de tourisme",
    "storefront",
    "2026-05-02T08:30:00.000Z",
  ]);
});

test("a customer without values gets empty cells, and archived fields never appear", () => {
  const result = buildCustomersExport({
    customers: [customer({ id: "cus_2", acquisitionSource: null, acquisitionSourceDetail: null })],
    definitions,
    valuesByCustomer,
    includeSensitive: true,
  });

  assert.ok(!result.headers.includes("Ancien champ"));
  assert.deepEqual(result.rows[0]?.slice(-3), ["2026-05-02T08:30:00.000Z", "", ""]);
  assert.equal(result.rows[0]?.[11], "");
});

test("column titles stay distinct when labels collide", () => {
  const result = buildCustomersExport({
    customers: [customer()],
    definitions: [
      { id: "a", label: "Phone", format: null, isSensitive: false, isActive: true },
      { id: "b", label: "Permis", format: null, isSensitive: false, isActive: true },
      { id: "c", label: "permis", format: null, isSensitive: false, isActive: true },
    ],
    valuesByCustomer: new Map([["cus_1", { a: "1", b: "2", c: "3" }]]),
    includeSensitive: false,
  });

  assert.deepEqual(result.headers.slice(-3), ["Phone (2)", "Permis", "permis (2)"]);
  assert.deepEqual(result.json[0]?.customFields, {
    "Phone (2)": "1",
    Permis: "2",
    "permis (2)": "3",
  });
});
