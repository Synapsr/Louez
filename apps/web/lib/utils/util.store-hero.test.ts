import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStoreHeroPresentation } from "./util.store-hero";

test("a store that never chose gets the cover layout, centred at the bottom", () => {
  assert.deepEqual(resolveStoreHeroPresentation({ theme: null, imageCount: 2 }), {
    shape: "cover",
    align: "center",
    verticalAlign: "end",
    textOnPhoto: true,
  });
});

test("the cover layout keeps the chosen position", () => {
  assert.deepEqual(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "cover", heroAlign: "end", heroVerticalAlign: "start" },
      imageCount: 1,
    }),
    { shape: "cover", align: "end", verticalAlign: "start", textOnPhoto: true },
  );
});

test("without a photo both layouts collapse to the centred band", () => {
  for (const heroLayout of ["cover", "split"] as const) {
    assert.deepEqual(
      resolveStoreHeroPresentation({
        theme: { heroLayout, heroAlign: "start", heroVerticalAlign: "start" },
        imageCount: 0,
      }),
      { shape: "band", align: "center", verticalAlign: "center", textOnPhoto: false },
    );
  }
});

test("the split layout has no horizontal centre: it reads as start, the vertical position stays", () => {
  assert.deepEqual(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "split", heroAlign: "center", heroVerticalAlign: "start" },
      imageCount: 3,
    }),
    { shape: "split", align: "start", verticalAlign: "start", textOnPhoto: false },
  );
  assert.equal(
    resolveStoreHeroPresentation({
      theme: { heroLayout: "split", heroAlign: "end" },
      imageCount: 3,
    }).align,
    "end",
  );
});
