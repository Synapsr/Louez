import assert from "node:assert/strict";
import { test } from "node:test";

import { getImportRequirements } from "./util.import-mapping";

const met = (entity: "customers" | "products", mapping: Record<string, string | null>) =>
  Object.fromEntries(getImportRequirements(entity, mapping).map((item) => [item.id, item.isMet]));

test("a customer file needs an e-mail or a phone, and a name", () => {
  assert.deepEqual(met("customers", { Tel: "field:phone", Client: "field:fullName" }), {
    contact: true,
    name: true,
  });
  assert.deepEqual(met("customers", { Mail: "field:email", Nom: "field:lastName" }), {
    contact: true,
    name: false,
  });
  assert.deepEqual(met("customers", { Ville: "field:city" }), { contact: false, name: false });
});

test("a catalogue needs a name and a price", () => {
  assert.deepEqual(met("products", { Nom: "field:name", Prix: "field:price" }), {
    productName: true,
    price: true,
  });
});
