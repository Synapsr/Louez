import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomerFieldAccount } from "@louez/validations";

import type { RentalDetailsItem } from "./reservation-rental-details.types";
import {
  buildRentalDetailsUpdate,
  canEditRentalDetails,
  getRentalDetailsDefaultValues,
  getRentalDetailsIssueName,
  getRentalDetailsIssues,
  toRentalUnitKey,
} from "./util.rental-details-form";

const field = (
  overrides: Partial<CustomerFieldAccount> & Pick<CustomerFieldAccount, "id">,
): CustomerFieldAccount => ({
  label: overrides.id,
  type: "number",
  format: null,
  options: null,
  unit: "cm",
  helpText: null,
  position: 0,
  width: "half",
  scope: "item",
  collectMode: "optional",
  isSensitive: false,
  appliesTo: "all",
  customerEditable: true,
  ...overrides,
});

const height = field({ id: "height", collectMode: "required" });
const locker = field({ id: "locker", type: "text", unit: null, customerEditable: false });

const bikes: RentalDetailsItem = {
  reservationItemId: "item-bikes",
  productId: "fat-bike",
  productName: "Fat bike",
  productImage: null,
  quantity: 2,
  fields: [height, locker],
  units: [
    { unitIndex: 0, participantName: "Léa", values: { height: "172", locker: "B12" } },
    { unitIndex: 1, participantName: null, values: {} },
  ],
};
const kayak: RentalDetailsItem = {
  reservationItemId: "item-kayak",
  productId: "kayak",
  productName: "Kayak",
  productImage: null,
  quantity: 1,
  fields: [locker],
  units: [{ unitIndex: 0, participantName: null, values: { locker: "C3" } }],
};

describe("rental details form", () => {
  it("opens with what was recorded", () => {
    assert.deepEqual(getRentalDetailsDefaultValues([bikes]), {
      units: {
        "item-bikes~0": { participantName: "Léa", values: { height: "172", locker: "B12" } },
        "item-bikes~1": { participantName: "", values: {} },
      },
    });
  });

  it("offers editing only before the start and when a field is the customer's", () => {
    assert.equal(canEditRentalDetails({ editable: true, items: [bikes] }), true);
    assert.equal(canEditRentalDetails({ editable: false, items: [bikes] }), false);
    assert.equal(canEditRentalDetails({ editable: true, items: [kayak] }), false);
  });

  it("sends every unit of the lines holding an editable field, editable values only", () => {
    const values = getRentalDetailsDefaultValues([bikes, kayak]);
    const second = values.units[toRentalUnitKey("item-bikes", 1)];
    values.units[toRentalUnitKey("item-bikes", 1)] = {
      ...second,
      participantName: " Tom ",
      values: { height: "152 " },
    };
    assert.deepEqual(buildRentalDetailsUpdate("resa-1", [bikes, kayak], values), {
      reservationId: "resa-1",
      items: [
        {
          reservationItemId: "item-bikes",
          units: [
            { unitIndex: 0, participantName: "Léa", values: { height: "172" } },
            { unitIndex: 1, participantName: "Tom", values: { height: "152" } },
          ],
        },
      ],
    });
  });

  it("flags a required value left empty at its input, and maps server issues the same way", () => {
    const issues = getRentalDetailsIssues([bikes], getRentalDetailsDefaultValues([bikes]));
    assert.deepEqual(issues, [
      { path: ["units", "item-bikes~1", "values", "height"], code: "required" },
    ]);
    assert.equal(
      getRentalDetailsIssueName({
        reservationItemId: "item-bikes",
        unitIndex: 1,
        definitionId: "height",
        code: "required",
      }),
      "units.item-bikes~1.values.height",
    );
  });
});
