import assert from "node:assert/strict";
import { test } from "node:test";

import { readUnitConflictRefusal } from "./unit-conflict-refusal";

const refusal = (data: unknown) => Object.assign(new Error("Not confirmed"), { data });
const conflict = (identifier: string) => ({
  reservationItemId: "itm",
  unitId: identifier,
  identifier,
});

test("names the units of a unit conflict, each once", () => {
  assert.deepEqual(
    readUnitConflictRefusal(
      refusal({
        code: "RESERVATION_UNITS_UNAVAILABLE",
        details: { conflicts: [conflict("S1"), conflict("L2"), conflict("S1")], bufferOnly: false },
      }),
    ),
    { identifiers: "S1, L2", bufferOnly: false },
  );
});

test("says when only the turnover buffer stands in the way", () => {
  assert.deepEqual(
    readUnitConflictRefusal(
      refusal({
        code: "RESERVATION_UNITS_UNAVAILABLE",
        details: { conflicts: [conflict("S1")], bufferOnly: true },
      }),
    ),
    { identifiers: "S1", bufferOnly: true },
  );
});

test("reads no other refusal as a unit conflict", () => {
  assert.equal(readUnitConflictRefusal(refusal({ code: "RESERVATION_ITEMS_UNAVAILABLE" })), null);
  assert.equal(
    readUnitConflictRefusal(
      refusal({ code: "RESERVATION_ITEMS_UNAVAILABLE", details: { conflicts: [conflict("S1")] } }),
    ),
    null,
  );
  assert.equal(
    readUnitConflictRefusal(refusal({ code: "RESERVATION_UNITS_UNAVAILABLE", details: {} })),
    null,
  );
  assert.equal(readUnitConflictRefusal(new Error("network")), null);
  assert.equal(readUnitConflictRefusal("RESERVATION_UNITS_UNAVAILABLE"), null);
});
