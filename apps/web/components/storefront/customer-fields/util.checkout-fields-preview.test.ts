import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

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

describe("resolvePreviewCheckoutFields", () => {
  it("shows everything a customer may be asked when no product is picked", () => {
    const resolved = resolvePreviewCheckoutFields(definitions, products, null);
    assert.deepEqual(ids(resolved.customerFields), ["id-number", "siret"]);
    assert.deepEqual(ids(resolved.itemFields), ["height", "locker"]);
  });

  it("narrows to one product and its categories", () => {
    assert.deepEqual(
      ids(resolvePreviewCheckoutFields(definitions, products, "fat-bike").itemFields),
      ["height"],
    );
    assert.deepEqual(ids(resolvePreviewCheckoutFields(definitions, products, "kayak").itemFields), [
      "locker",
    ]);
  });

  it("still shows fields asked for every product in a store without products", () => {
    const resolved = resolvePreviewCheckoutFields(definitions, [], null);
    assert.deepEqual(ids(resolved.customerFields), ["id-number", "siret"]);
    assert.deepEqual(ids(resolved.itemFields), []);
  });
});
