import assert from "node:assert/strict";
import { test } from "node:test";

import { NeedsALookRowBoundary } from "./needs-a-look-row-boundary";

// A row that throws while rendering is left out; the others render on.

test("a failing row renders nothing, a sound one its children", () => {
  const sound = new NeedsALookRowBoundary({ children: "row" });
  assert.equal(sound.render(), "row");

  const failing = new NeedsALookRowBoundary({ children: "row" });
  failing.state = NeedsALookRowBoundary.getDerivedStateFromError();
  assert.equal(failing.render(), null);
});
