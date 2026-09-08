import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStoreHeroPresentation } from "./util.store-hero";

test("a store that never chose gets the cover layout, centred", () => {
  assert.deepEqual(resolveStoreHeroPresentation({ theme: null, imageCount: 2 }), {
    shape: "cover",
    align: "center",
    textOnPhoto: true,
  });
});

test("the cover layout keeps the chosen alignment", () => {
  assert.deepEqual(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "cover", heroAlign: "end" },
      imageCount: 1,
    }),
    { shape: "cover", align: "end", textOnPhoto: true },
  );
});

test("without a photo both layouts collapse to the centred band", () => {
  for (const heroLayout of ["cover", "split"] as const) {
    assert.deepEqual(
      resolveStoreHeroPresentation({ theme: { heroLayout, heroAlign: "start" }, imageCount: 0 }),
      { shape: "band", align: "center", textOnPhoto: false },
    );
  }
});

test("the split layout has no centre: it reads as start", () => {
  assert.deepEqual(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "split", heroAlign: "center" },
      imageCount: 3,
    }),
    { shape: "split", align: "start", textOnPhoto: false },
  );
  assert.equal(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "split", heroAlign: "end" },
      imageCount: 3,
    }).align,
    "end",
  );
});
