import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isTemplateAdopted, listFeaturedTemplates } from "./util.customer-field-templates";

const template = (id: string, keys: string[]) => ({
  id,
  fields: keys.map((key) => ({ key })),
});

const ski = template("ski", ["height_cm", "weight_kg"]);
const bikes = template("bikes", ["height_cm", "saddle"]);

describe("isTemplateAdopted", () => {
  test("only once every one of its fields is in", () => {
    assert.equal(isTemplateAdopted(ski, new Set(["height_cm"])), false);
    assert.equal(isTemplateAdopted(ski, new Set(["height_cm", "weight_kg"])), true);
  });
});

describe("listFeaturedTemplates", () => {
  test("the store's suggestions come first", () => {
    assert.deepEqual(
      listFeaturedTemplates({
        templates: [ski, bikes],
        suggestions: [bikes],
        adoptedKeys: new Set(),
      }),
      [bikes],
    );
  });

  test("without any, the tab's templates not taken yet", () => {
    assert.deepEqual(
      listFeaturedTemplates({
        templates: [ski, bikes],
        suggestions: [],
        adoptedKeys: new Set(["height_cm", "saddle"]),
      }),
      [ski],
    );
  });
});
