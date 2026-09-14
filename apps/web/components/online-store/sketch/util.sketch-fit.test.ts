import assert from "node:assert/strict";
import { test } from "node:test";

import { getSketchFit } from "./util.sketch-fit";

test("waits for the canvas to be measured", () => {
  assert.equal(getSketchFit({ device: "phone", width: 0, height: 800 }), null);
  assert.equal(getSketchFit({ device: "desktop", width: 900, height: 0 }), null);
});

test("fits the phone to the tighter of the canvas width and height", () => {
  // The frame is 414 × 868: a short canvas decides.
  assert.deepEqual(getSketchFit({ device: "phone", width: 900, height: 434 }), {
    device: "phone",
    zoom: 0.5,
  });
  // A narrow one decides.
  assert.deepEqual(getSketchFit({ device: "phone", width: 207, height: 2000 }), {
    device: "phone",
    zoom: 0.5,
  });
});

test("never enlarges the phone", () => {
  assert.equal(getSketchFit({ device: "phone", width: 2000, height: 2000 })?.zoom, 1);
});

test("shrinks the desktop window to the width and makes it as tall as the canvas", () => {
  assert.deepEqual(getSketchFit({ device: "desktop", width: 640, height: 500 }), {
    device: "desktop",
    zoom: 0.5,
    windowHeight: 1000,
  });
  assert.deepEqual(getSketchFit({ device: "desktop", width: 1600, height: 900 }), {
    device: "desktop",
    zoom: 1,
    windowHeight: 900,
  });
});
