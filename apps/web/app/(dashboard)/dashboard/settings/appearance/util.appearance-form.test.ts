import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AppearanceFormValues,
  buildAppearanceDefaults,
  buildAppearancePayload,
  listReplacedImages,
  parseHexInput,
} from "./util.appearance-form";

const baseline: AppearanceFormValues = {
  logoUrl: "https://s3/logo.png",
  darkLogoUrl: null,
  primaryColor: "#2563eb",
  themeMode: "light",
  heroLayout: "cover",
  heroAlign: "center",
  heroVerticalAlign: "end",
  heroImages: ["https://s3/hero-1.jpg"],
  catalogBrowseMode: "products",
  maxDiscountEnabled: false,
  maxDiscountPercent: 50,
};

test("a store without a theme gets the cover layout, centred", () => {
  const defaults = buildAppearanceDefaults({
    id: "s1",
    name: "Ar Mor",
    slug: "ar-mor",
    logoUrl: null,
    darkLogoUrl: null,
    theme: null,
  });
  assert.equal(defaults.heroLayout, "cover");
  assert.equal(defaults.heroAlign, "center");
  assert.equal(defaults.heroVerticalAlign, "end");
  assert.equal(defaults.maxDiscountEnabled, false);
});

test("the payload carries the hero layout and alignment, and clears the dark logo in light mode", () => {
  const payload = buildAppearancePayload({
    value: {
      ...baseline,
      heroLayout: "split",
      heroAlign: "end",
      heroVerticalAlign: "start",
      maxDiscountEnabled: true,
    },
    baseline,
  });
  assert.deepEqual(payload, {
    logoUrl: "https://s3/logo.png",
    darkLogoUrl: null,
    theme: {
      mode: "light",
      primaryColor: "#2563eb",
      heroLayout: "split",
      heroAlign: "end",
      heroVerticalAlign: "start",
      catalogBrowseMode: "products",
      maxDiscountPercent: 50,
      heroImages: ["https://s3/hero-1.jpg"],
    },
  });
});

test("an untouched legacy base64 image is left out; an edited one refuses the save", () => {
  const legacy = { ...baseline, logoUrl: "data:image/png;base64,abc" };
  const kept = buildAppearancePayload({ value: legacy, baseline: legacy });
  assert.ok(kept);
  assert.equal("logoUrl" in kept, false);

  assert.equal(buildAppearancePayload({ value: legacy, baseline }), null);
});

test("replaced images are the saved ones the new values no longer reference", () => {
  assert.deepEqual(
    listReplacedImages({
      value: { ...baseline, logoUrl: "https://s3/logo-2.png", heroImages: [] },
      baseline,
    }),
    { logos: ["https://s3/logo.png"], heroes: ["https://s3/hero-1.jpg"] },
  );
});

test("hex input accepts a pasted value with or without the hash", () => {
  assert.equal(parseHexInput("#FFFE55"), "#fffe55");
  assert.equal(parseHexInput("fffe55"), "#fffe55");
  assert.equal(parseHexInput("fff"), null);
});
