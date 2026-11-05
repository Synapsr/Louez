import assert from "node:assert/strict";
import { test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

import {
  type ContractItemDetailsSource,
  getContractItemDetailLines,
} from "./util.contract-item-details";

const field = (
  overrides: Partial<CustomerFieldDefinition> & Pick<CustomerFieldDefinition, "id" | "label">,
): CustomerFieldDefinition => ({
  key: overrides.id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "Ski",
  position: 0,
  width: "half",
  appliesTo: "all",
  isRequired: false,
  isSensitive: false,
  showOnContract: true,
  isSearchable: false,
  showInList: false,
  templateKey: null,
  isActive: true,
  scope: "item",
  collectMode: "optional",
  targetMode: "products",
  customerEditable: false,
  targets: [],
  ...overrides,
});

const height = field({ id: "height", label: "Taille", type: "number", unit: "cm" });
const shoe = field({ id: "shoe", label: "Pointure", type: "number" });
const level = field({ id: "level", label: "Niveau", showOnContract: false });

const options: Parameters<typeof getContractItemDetailLines>[1] = {
  formatDate: (isoDate) => `date(${isoDate})`,
};

const texts = (sources: ContractItemDetailsSource[], itemId: string) =>
  getContractItemDetailLines(sources, options)
    .get(itemId)
    ?.map((line) => line.text);

test("prints each unit's contract fields after the participant's name", () => {
  const sources: ContractItemDetailsSource[] = [
    {
      reservationItemId: "skis",
      quantity: 2,
      fields: [height, shoe, level],
      units: [
        {
          unitIndex: 0,
          participantName: "Léa",
          values: { height: "172", shoe: "38", level: "Débutant" },
        },
        { unitIndex: 1, participantName: "Tom", values: { height: "152" } },
      ],
    },
  ];

  assert.deepEqual(getContractItemDetailLines(sources, options).get("skis"), [
    { id: "skis:0", text: "Léa — Taille : 172 cm · Pointure : 38" },
    { id: "skis:1", text: "Tom — Taille : 152 cm" },
  ]);
});

test("a unit without a name is told apart by its position, a single unit needs neither", () => {
  assert.deepEqual(
    texts(
      [
        {
          reservationItemId: "skis",
          quantity: 3,
          fields: [height],
          units: [{ unitIndex: 1, participantName: "  ", values: { height: "140" } }],
        },
      ],
      "skis",
    ),
    ["2/3 — Taille : 140 cm"],
  );
  assert.deepEqual(
    texts(
      [
        {
          reservationItemId: "bike",
          quantity: 1,
          fields: [height],
          units: [{ unitIndex: 0, participantName: null, values: { height: "180" } }],
        },
      ],
      "bike",
    ),
    ["Taille : 180 cm"],
  );
});

test("a named unit is printed even before its measurements are known", () => {
  assert.deepEqual(
    texts(
      [
        {
          reservationItemId: "skis",
          quantity: 2,
          fields: [height],
          units: [
            { unitIndex: 0, participantName: "Léa", values: {} },
            { unitIndex: 1, participantName: null, values: {} },
          ],
        },
      ],
      "skis",
    ),
    ["Léa"],
  );
});

test("a line whose fields are not flagged for the contract prints nothing, names included", () => {
  const lines = getContractItemDetailLines(
    [
      {
        reservationItemId: "skis",
        quantity: 1,
        fields: [level, field({ id: "old", label: "Ancien", isActive: false })],
        units: [{ unitIndex: 0, participantName: "Léa", values: { level: "Expert", old: "x" } }],
      },
    ],
    options,
  );

  assert.equal(lines.size, 0);
});

test("units past a lowered quantity are left out", () => {
  assert.deepEqual(
    texts(
      [
        {
          reservationItemId: "skis",
          quantity: 1,
          fields: [height],
          units: [
            { unitIndex: 0, participantName: "Léa", values: { height: "172" } },
            { unitIndex: 1, participantName: "Tom", values: { height: "152" } },
          ],
        },
      ],
      "skis",
    ),
    ["Léa — Taille : 172 cm"],
  );
});

test("formats values like the customer's contract fields: dates, ticked boxes, sensitive values in full", () => {
  assert.deepEqual(
    texts(
      [
        {
          reservationItemId: "kayak",
          quantity: 1,
          fields: [
            field({ id: "birth", label: "Né le", type: "date" }),
            field({ id: "swim", label: "Sait nager", type: "checkbox" }),
            field({ id: "vest", label: "Gilet", type: "checkbox" }),
            field({ id: "weight", label: "Poids", type: "number", unit: "kg", isSensitive: true }),
          ],
          units: [
            {
              unitIndex: 0,
              participantName: "Léa",
              values: { birth: "2012-05-04", swim: "true", vest: "", weight: "41" },
            },
          ],
        },
      ],
      "kayak",
    ),
    ["Léa — Né le : date(2012-05-04) · Sait nager · Poids : 41 kg"],
  );
});
