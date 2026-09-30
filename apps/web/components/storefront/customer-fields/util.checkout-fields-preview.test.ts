import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";
import { resolveCustomerProfileSettings } from "@louez/validations";

import { resolvePreviewCheckoutFields } from "./util.checkout-fields-preview";

const definition = (
  overrides: Partial<CustomerFieldDefinition> & Pick<CustomerFieldDefinition, "id">,
): CustomerFieldDefinition => ({
  key: overrides.id,
  label: overrides.id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "Infos",
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
  collectMode: "optional",
  targetMode: "all",
  customerEditable: false,
  targets: [],
  ...overrides,
});

const idNumber = definition({ id: "id-number" });
const siret = definition({ id: "siret", appliesTo: "business" });
const teamOnly = definition({ id: "team-only", collectMode: "never" });
const height = definition({
  id: "height",
  scope: "item",
  targetMode: "products",
  targets: [{ type: "category", id: "bikes" }],
});
const locker = definition({
  id: "locker",
  scope: "item",
  targetMode: "products",
  targets: [{ type: "product", id: "kayak" }],
});
const nobody = definition({ id: "nobody", scope: "item", targetMode: "products", targets: [] });

const definitions = [idNumber, siret, teamOnly, height, locker, nobody];
const products = [
  { id: "fat-bike", categoryIds: ["bikes"] },
  { id: "kayak", categoryIds: ["water"] },
];

const ids = (fields: readonly { id: string }[]) => fields.map((field) => field.id);
const noProfile = resolveCustomerProfileSettings(undefined);

describe("resolvePreviewCheckoutFields", () => {
  it("shows everything a customer may be asked when no product is picked", () => {
    const resolved = resolvePreviewCheckoutFields(definitions, products, null, noProfile);
    assert.deepEqual(ids(resolved.customerFields), ["id-number", "siret"]);
    assert.deepEqual(ids(resolved.itemFields), ["height", "locker"]);
  });

  it("narrows to one product and its categories", () => {
    assert.deepEqual(
      ids(resolvePreviewCheckoutFields(definitions, products, "fat-bike", noProfile).itemFields),
      ["height"],
    );
    assert.deepEqual(
      ids(resolvePreviewCheckoutFields(definitions, products, "kayak", noProfile).itemFields),
      ["locker"],
    );
  });

  it("still shows fields asked for every product in a store without products", () => {
    const resolved = resolvePreviewCheckoutFields(definitions, [], null, noProfile);
    assert.deepEqual(ids(resolved.customerFields), ["id-number", "siret"]);
    assert.deepEqual(ids(resolved.itemFields), []);
  });
});

describe("resolvePreviewCheckoutFields: native profile fields", () => {
  const profileSettings = resolveCustomerProfileSettings({
    birthDate: {
      visibility: "optional",
      collectMode: "required",
      targetMode: "products",
      targets: [{ type: "category", id: "bikes" }],
    },
    acquisitionSource: { visibility: "optional", collectMode: "optional" },
    socialLinks: { visibility: "hidden", collectMode: "optional" },
  });
  const keys = (fields: readonly { key: string }[]) => fields.map((field) => field.key);

  it("shows every native field some product is asked when no product is picked", () => {
    const resolved = resolvePreviewCheckoutFields([], products, null, profileSettings);
    assert.deepEqual(keys(resolved.profileFields), ["birthDate", "acquisitionSource"]);
  });

  it("narrows to what one product is asked; a hidden field never shows", () => {
    assert.deepEqual(
      keys(resolvePreviewCheckoutFields([], products, "kayak", profileSettings).profileFields),
      ["acquisitionSource"],
    );
    assert.deepEqual(
      resolvePreviewCheckoutFields([], products, "fat-bike", profileSettings).profileFields,
      [
        { key: "birthDate", collectMode: "required" },
        { key: "acquisitionSource", collectMode: "optional" },
      ],
    );
  });
});

describe("resolvePreviewCheckoutFields: layout", () => {
  it("lays the contact step out as the owner did: native and custom interleaved", () => {
    const profileSettings = resolveCustomerProfileSettings({
      birthDate: { visibility: "optional", collectMode: "optional" },
    });
    const resolved = resolvePreviewCheckoutFields(
      [idNumber, definition({ id: "late", position: 9, width: "full" })],
      products,
      null,
      profileSettings,
      { birthDate: { position: 5, width: "full" } },
    );
    assert.deepEqual(resolved.customerLayout, [
      { kind: "custom", key: "id-number", width: "half" },
      { kind: "builtin", key: "birthDate", width: "full" },
      { kind: "custom", key: "late", width: "full" },
    ]);
  });

  it("gives a unit card's fields in position order", () => {
    const later = definition({ id: "later", scope: "item", position: 5 });
    const sooner = definition({ id: "sooner", scope: "item", position: 1 });
    assert.deepEqual(
      ids(resolvePreviewCheckoutFields([later, sooner], [], null, noProfile).itemFields),
      ["sooner", "later"],
    );
  });
});
