import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  computeInspectorDrawerLayout,
  isSameInspectorDrawerLayout,
} from "./util.inspector-drawer-layout";

// The dashboard at 1440×900: the sidebar, then the panel scrolling under its header.
const desktop = {
  viewport: { width: 1440, height: 900 },
  panel: { top: 65, right: 1431, bottom: 891, left: 265, width: 1166 },
  frame: { left: 597, right: 1399 },
};

describe("computeInspectorDrawerLayout", () => {
  test("docks the drawer inside the panel and pushes the page just clear of it", () => {
    assert.deepEqual(computeInspectorDrawerLayout(desktop), {
      mode: "side",
      top: 73,
      right: 17,
      bottom: 17,
      width: 400,
      push: 400 - (1431 - 8 - 1399) + 20,
    });
  });

  test("a narrower panel gets a narrower drawer, never under its minimum", () => {
    const layout = computeInspectorDrawerLayout({
      viewport: { width: 1280, height: 800 },
      panel: { top: 65, right: 1271, bottom: 791, left: 265, width: 1006 },
      frame: { left: 597, right: 1239 },
    });
    assert.equal(layout.mode, "side");
    if (layout.mode === "side") {
      assert.equal(layout.width, 352);
      assert.ok(1239 - 597 - layout.push >= 280);
    }
  });

  test("a page far from the drawer is not pushed", () => {
    const layout = computeInspectorDrawerLayout({
      ...desktop,
      viewport: { width: 2560, height: 1440 },
      panel: { top: 65, right: 2551, bottom: 1431, left: 265, width: 2286 },
      frame: { left: 900, right: 1924 },
    });
    assert.equal(layout.mode === "side" && layout.push, 0);
  });

  test("covers the screen when the form would be left too narrow, and on phones", () => {
    assert.deepEqual(
      computeInspectorDrawerLayout({
        viewport: { width: 660, height: 1024 },
        panel: { top: 56, right: 660, bottom: 1024, left: 0, width: 660 },
        frame: { left: 24, right: 636 },
      }),
      { mode: "sheet" },
    );
    assert.deepEqual(
      computeInspectorDrawerLayout({
        viewport: { width: 390, height: 844 },
        panel: { top: 56, right: 390, bottom: 844, left: 0, width: 390 },
        frame: { left: 16, right: 374 },
      }),
      { mode: "sheet" },
    );
  });
});

describe("isSameInspectorDrawerLayout", () => {
  test("compares every measure, and any two sheets", () => {
    const layout = computeInspectorDrawerLayout(desktop);
    assert.equal(isSameInspectorDrawerLayout(layout, computeInspectorDrawerLayout(desktop)), true);
    assert.equal(
      isSameInspectorDrawerLayout(
        layout,
        computeInspectorDrawerLayout({ ...desktop, frame: { left: 597, right: 1380 } }),
      ),
      false,
    );
    assert.equal(isSameInspectorDrawerLayout(null, layout), false);
    assert.equal(isSameInspectorDrawerLayout({ mode: "sheet" }, { mode: "sheet" }), true);
  });
});
