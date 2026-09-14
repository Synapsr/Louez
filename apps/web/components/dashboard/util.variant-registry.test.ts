import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCombinationKey, findMatchingVariant } from "@louez/utils";
import { createProductSchema, productSchema } from "@louez/validations";

import { filterActiveVariantAxes } from "@/lib/util.variant-visibility";
import { resolveVariantPresets } from "@/lib/variant-presets";

import { buildVariantRegistry, type VariantCatalogDefinition } from "./util.variant-registry";

const presets = resolveVariantPresets((key) => key);
const size: VariantCatalogDefinition = {
  id: "size-definition",
  key: "size",
  label: "Size",
  kind: "size",
  isActive: true,
  values: ["S", "M", "L"].map((label) => ({ label, colorHex: null })),
};
const legacyAxis = { key: "taille", label: "taille", position: 0 };

test("adding a second L preserves existing sizes, product axes and reservation combinations", () => {
  const axes = [legacyAxis];
  const units = ["L", "M", "M", "S"].map((value, index) => ({
    identifier: `bike-${index}`,
    attributes: { [legacyAxis.key]: value },
  }));
  const before = units.map((unit) => buildCombinationKey(axes, unit.attributes));
  const registry = buildVariantRegistry(axes, [size], presets);
  const entry = registry.find((candidate) => candidate.definitionId === size.id);
  assert(entry);
  assert.equal(entry.key, "taille");
  assert.equal(entry.catalogKey, "size");
  assert.equal(registry.filter((candidate) => candidate.kind === "size").length, 1);
  assert.deepEqual(
    units.map((unit) => unit.attributes[entry.key]),
    ["L", "M", "M", "S"],
  );
  assert.equal(findMatchingVariant(entry.key, axes), legacyAxis);

  const data = {
    name: "Test bike",
    description: "",
    aiContext: "",
    imageHistory: [],
    pricingTiers: [],
    rateTiers: [],
    enforceStrictTiers: true,
    promotion: null,
    taxSettings: { inheritFromStore: true },
    videoUrl: "",
    accessories: [],
    price: "10",
    deposit: "",
    quantity: "5",
    status: "active",
    images: [],
    categoryIds: [],
    stockKind: "returnable",
    pricingKind: "duration",
    pricingMode: "day",
    basePriceDuration: { price: "10", duration: 1, unit: "day" },
    trackUnits: true,
    bookingAttributeAxes: axes,
    units: [...units, { identifier: "bike-L2", attributes: { [entry.key]: "L" } }],
  };
  for (const schema of [createProductSchema((key) => key), productSchema]) {
    const result = schema.safeParse(data);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    if (!result.success) continue;
    assert.deepEqual(result.data.bookingAttributeAxes, axes);
    assert.deepEqual(
      result.data.units
        ?.slice(0, 4)
        .map((unit) => buildCombinationKey(result.data.bookingAttributeAxes, unit.attributes)),
      before,
    );
  }
});

test("legacy keys use stable catalog identity even before the catalog loads or after a language change", () => {
  for (const [legacy, canonical] of [
    ["taille", "size"],
    ["Größe", "size"],
    ["talla", "size"],
    ["couleur", "color"],
    ["pointure", "shoe-size"],
    ["mati_re", "material"],
  ]) {
    const axes = [{ key: legacy, label: "An unrelated translated label" }];
    const definition = { ...size, key: canonical, label: "A renamed catalog label" };
    const registry = buildVariantRegistry(axes, [definition], presets);
    assert.equal(registry.find((entry) => entry.definitionId === size.id)?.key, legacy);
    assert.equal(registry.find((entry) => entry.definitionId === size.id)?.catalogKey, canonical);
  }
  const registry = buildVariantRegistry([legacyAxis], [], presets);
  assert.equal(registry.find((entry) => entry.key === "taille")?.catalogKey, "size");
  assert(!registry.some((entry) => entry.key === "size"));
});

test("new products use canonical keys and matching catalog definitions win over presets", () => {
  const registry = buildVariantRegistry([], [size], presets);
  assert.equal(registry.find((entry) => entry.key === "size")?.definitionId, size.id);
  assert.equal(registry.filter((entry) => entry.key === "size").length, 1);
  assert.equal(
    buildVariantRegistry([], [], presets).find((entry) => entry.key === "size")?.catalogKey,
    "size",
  );
});

test("disabled presets stay hidden under their legacy product keys", () => {
  const inactive = { ...size, isActive: false };
  assert.deepEqual(filterActiveVariantAxes([legacyAxis], [inactive]), []);
  assert(
    !buildVariantRegistry([legacyAxis], [inactive], presets).some((entry) => entry.kind === "size"),
  );
});

test("custom axes with the same label remain separate and editable", () => {
  const custom = { key: "frame_size", label: "Size", position: 1 };
  const registry = buildVariantRegistry([legacyAxis, custom], [size], presets);
  assert(registry.some((entry) => entry.key === "taille"));
  assert(registry.some((entry) => entry.key === custom.key && !entry.definitionId));
  assert.deepEqual(filterActiveVariantAxes([custom], [{ ...size, isActive: false }]), [custom]);
});

test("an exact historical catalog definition takes precedence over its canonical equivalent", () => {
  const historical = { ...size, id: "legacy-definition", key: "taille" };
  const registry = buildVariantRegistry([legacyAxis], [size, historical], presets);
  assert.equal(registry.find((entry) => entry.key === "taille")?.definitionId, historical.id);
  assert.equal(registry.filter((entry) => entry.kind === "size").length, 1);
});
