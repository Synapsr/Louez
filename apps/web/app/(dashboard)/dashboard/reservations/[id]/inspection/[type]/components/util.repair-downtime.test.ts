import assert from "node:assert/strict";
import { test } from "node:test";

import { reservationLinesByUnit } from "./util.repair-downtime";

test("each unit's repair leaves out only the lines that hold it", () => {
  const lines = reservationLinesByUnit([
    { reservationItemId: "line_kayak", productUnitId: "unit_k1" },
    { reservationItemId: "line_kayak", productUnitId: "unit_k2" },
    { reservationItemId: "line_paddle", productUnitId: "unit_p1" },
    { reservationItemId: "line_helmet", productUnitId: null },
  ]);
  assert.deepEqual(lines.get("unit_k1"), ["line_kayak"]);
  assert.deepEqual(lines.get("unit_k2"), ["line_kayak"]);
  assert.deepEqual(lines.get("unit_p1"), ["line_paddle"]);
  assert.equal(lines.get("unit_other"), undefined);
  assert.equal(lines.size, 3, "a line without a unit excludes nothing");
});

test("a unit listed twice on one line is sent once", () => {
  const lines = reservationLinesByUnit([
    { reservationItemId: "line_a", productUnitId: "unit_1" },
    { reservationItemId: "line_a", productUnitId: "unit_1" },
  ]);
  assert.deepEqual(lines.get("unit_1"), ["line_a"]);
});
