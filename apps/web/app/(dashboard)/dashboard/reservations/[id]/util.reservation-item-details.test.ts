import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getItemDetailRows,
  getMissingRequiredFieldIds,
  getUnitPosition,
  indexItemDetailIssues,
  toItemDetailsFormValues,
  toItemDetailsUpdateInput,
  type ItemDetailsLine,
} from "./util.reservation-item-details";

type Field = { id: string; collectMode: "never" | "optional" | "required"; label: string };

const height: Field = { id: "height", collectMode: "required", label: "Taille" };
const saddle: Field = { id: "saddle", collectMode: "optional", label: "Hauteur de selle" };
const locker: Field = { id: "locker", collectMode: "never", label: "Casier" };

const bikes: ItemDetailsLine<Field> = {
  reservationItemId: "item-bikes",
  productName: "VTT électrique",
  quantity: 2,
  fields: [height, saddle, locker],
  units: [
    { unitIndex: 0, participantName: "Léa", values: { height: "172", saddle: "80.5" } },
    { unitIndex: 1, participantName: null, values: { saddle: "76" } },
  ],
};

test("one row per unit: its position, its values and the required ones still missing, in field order", () => {
  const rows = getItemDetailRows([bikes]);

  assert.deepEqual(
    rows.map((row) => ({
      key: row.key,
      position: row.position,
      participantName: row.participantName,
      entries: row.entries.map((entry) => `${entry.field.label}=${entry.value ?? "missing"}`),
      isIncomplete: row.isIncomplete,
    })),
    [
      {
        key: "item-bikes:0",
        position: "1/2",
        participantName: "Léa",
        entries: ["Taille=172", "Hauteur de selle=80.5"],
        isIncomplete: false,
      },
      {
        key: "item-bikes:1",
        position: "2/2",
        participantName: null,
        entries: ["Taille=missing", "Hauteur de selle=76"],
        isIncomplete: true,
      },
    ],
  );
});

test("a single unit shows no position", () => {
  assert.equal(getUnitPosition(0, 1), null);
  assert.equal(getUnitPosition(2, 3), "3/3");
});

test("units past a lowered quantity are neither shown nor edited", () => {
  const lowered: ItemDetailsLine<Field> = { ...bikes, quantity: 1 };

  assert.deepEqual(
    getItemDetailRows([lowered]).map((row) => ({ key: row.key, position: row.position })),
    [{ key: "item-bikes:0", position: null }],
  );
  assert.deepEqual(
    toItemDetailsFormValues([lowered]).items[0]?.units.map((unit) => unit.unitIndex),
    [0],
  );
});

test("only a field asked as required online makes a unit incomplete", () => {
  assert.deepEqual(getMissingRequiredFieldIds([height, saddle, locker], {}), ["height"]);
  assert.deepEqual(getMissingRequiredFieldIds([height], { height: "  " }), ["height"]);
  assert.deepEqual(getMissingRequiredFieldIds([height], { height: "150" }), []);
});

test("the form holds every field of every unit, empty ones as blank strings", () => {
  assert.deepEqual(toItemDetailsFormValues([bikes]), {
    items: [
      {
        reservationItemId: "item-bikes",
        units: [
          {
            unitIndex: 0,
            participantName: "Léa",
            values: { height: "172", saddle: "80.5", locker: "" },
          },
          { unitIndex: 1, participantName: "", values: { height: "", saddle: "76", locker: "" } },
        ],
      },
    ],
  });
});

test("saving sends only the units staff changed", () => {
  const initial = toItemDetailsFormValues([bikes]);
  const current = structuredClone(initial);
  const secondUnit = current.items[0]?.units[1];
  assert.ok(secondUnit);
  secondUnit.values.height = "152";

  assert.deepEqual(toItemDetailsUpdateInput("res-1", initial, current), {
    reservationId: "res-1",
    items: [
      {
        reservationItemId: "item-bikes",
        units: [
          {
            unitIndex: 1,
            participantName: "",
            values: { height: "152", saddle: "76", locker: "" },
          },
        ],
      },
    ],
  });
});

test("nothing changed, or only surrounding spaces, means nothing to send", () => {
  const initial = toItemDetailsFormValues([bikes]);
  const current = structuredClone(initial);
  const firstUnit = current.items[0]?.units[0];
  assert.ok(firstUnit);
  firstUnit.participantName = " Léa ";

  assert.equal(toItemDetailsUpdateInput("res-1", initial, initial), null);
  assert.equal(toItemDetailsUpdateInput("res-1", initial, current), null);
});

test("clearing a value is a change", () => {
  const initial = toItemDetailsFormValues([bikes]);
  const current = structuredClone(initial);
  const firstUnit = current.items[0]?.units[0];
  assert.ok(firstUnit);
  firstUnit.values.saddle = "";

  assert.deepEqual(
    toItemDetailsUpdateInput("res-1", initial, current)?.items[0]?.units.map(
      (unit) => unit.unitIndex,
    ),
    [0],
  );
});

test("server issues are keyed by line, unit and field", () => {
  assert.deepEqual(
    indexItemDetailIssues([
      {
        reservationItemId: "item-bikes",
        unitIndex: 1,
        definitionId: "height",
        code: "invalidNumber",
      },
    ]),
    { "item-bikes:1:height": "invalidNumber" },
  );
});
