import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planCustomerFieldValuesSave } from "@louez/api/services/customer-fields";

const licence = { id: "l".repeat(21), type: "text" as const };
const notes = { id: "n".repeat(21), type: "textarea" as const };
const phone = { id: "p".repeat(21), type: "phone" as const };
const definitions = [licence, notes, phone];

describe("checkout values: signed in (overwrite) or not (fillEmpty)", () => {
  test("overwrite clears blanks and replaces what is on file", () => {
    const plan = planCustomerFieldValuesSave({
      values: { [licence.id]: "AB-12", [notes.id]: "", [phone.id]: "+33 6 12 34 56 78" },
      definitions,
      mode: "overwrite",
    });
    assert.deepEqual(plan.cleared, [notes.id]);
    assert.equal(plan.replaceExisting, true);
    assert.deepEqual(plan.upserts, [
      { definitionId: licence.id, value: "AB-12", searchValue: "ab12" },
      { definitionId: phone.id, value: "+33 6 12 34 56 78", searchValue: "33612345678" },
    ]);
  });

  test("overwrite is the default", () => {
    const plan = planCustomerFieldValuesSave({ values: { [notes.id]: "" }, definitions });
    assert.deepEqual(plan.cleared, [notes.id]);
    assert.equal(plan.replaceExisting, true);
  });

  test("fillEmpty never clears nor replaces: it only adds what is missing", () => {
    const plan = planCustomerFieldValuesSave({
      values: { [licence.id]: "ZZ-99", [notes.id]: "" },
      definitions,
      mode: "fillEmpty",
    });
    assert.deepEqual(plan.cleared, []);
    assert.equal(plan.replaceExisting, false);
    assert.deepEqual(
      plan.upserts.map((upsert) => upsert.definitionId),
      [licence.id],
    );
  });

  test("values of definitions the caller did not pass are ignored", () => {
    const plan = planCustomerFieldValuesSave({
      values: { ["x".repeat(21)]: "intruder", [notes.id]: "Rider" },
      definitions: [notes],
    });
    assert.deepEqual(plan.upserts, [{ definitionId: notes.id, value: "Rider", searchValue: null }]);
  });
});
