import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PricingBreakdown } from "@louez/types";

import { compareReservationDemand, fingerprintReservationEdit } from "./util.reservation-edit";

const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date("2031-06-12T09:00:00.000Z");
const DAY = 86_400_000;

const reservation = {
  status: "confirmed",
  startDate: START,
  endDate: END,
  subtotalAmount: "20.00",
  depositAmount: "0.00",
  totalAmount: "30.00",
  deliveryFee: "15.00",
  discountAmount: "5.00",
  tulipInsuranceOptIn: null,
  tulipInsuranceAmount: null,
};
const manualPrice: PricingBreakdown = {
  basePrice: 10,
  effectivePrice: 10,
  duration: 2,
  pricingMode: "day",
  pricingKind: "duration",
  discountPercent: null,
  discountAmount: 0,
  tierApplied: null,
  taxRate: null,
  taxAmount: null,
  subtotalExclTax: null,
  subtotalInclTax: null,
  isManualOverride: true,
};
const item: {
  id: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  depositPerUnit: string;
  pricingBreakdown: PricingBreakdown | null;
} = {
  id: "itm_a",
  productId: "bike",
  quantity: 1,
  unitPrice: "10.00",
  totalPrice: "20.00",
  depositPerUnit: "0.00",
  pricingBreakdown: null,
};

describe("fingerprintReservationEdit", () => {
  const basis = fingerprintReservationEdit(reservation, [item]);

  test("two reads of the same reservation agree, whatever the money's digits or the lines' order", () => {
    const other = { ...item, id: "itm_b", productId: "helmet" };
    assert.equal(
      fingerprintReservationEdit({ ...reservation, totalAmount: "30" }, [
        { ...item, unitPrice: "10", totalPrice: "20", depositPerUnit: "0" },
      ]),
      basis,
    );
    assert.equal(
      fingerprintReservationEdit(reservation, [other, item]),
      fingerprintReservationEdit(reservation, [item, other]),
    );
  });

  test("every field an edit is computed from changes it", () => {
    const changes = [
      { status: "ongoing" },
      { startDate: new Date(START.getTime() + 1) },
      { endDate: new Date(END.getTime() + 1) },
      { subtotalAmount: "21.00" },
      { depositAmount: "1.00" },
      { totalAmount: "31.00" },
      { deliveryFee: "0.00" },
      { discountAmount: "0.00" },
      { tulipInsuranceOptIn: true },
      { tulipInsuranceAmount: "4.00" },
    ];
    for (const change of changes) {
      assert.notEqual(
        fingerprintReservationEdit({ ...reservation, ...change }, [item]),
        basis,
        JSON.stringify(change),
      );
    }

    const itemChanges = [
      { id: "itm_z" },
      { productId: "helmet" },
      { quantity: 2 },
      { unitPrice: "11.00" },
      { totalPrice: "22.00" },
      { depositPerUnit: "5.00" },
      { pricingBreakdown: manualPrice },
    ];
    for (const change of itemChanges) {
      assert.notEqual(
        fingerprintReservationEdit(reservation, [{ ...item, ...change }]),
        basis,
        JSON.stringify(change),
      );
    }
    assert.notEqual(fingerprintReservationEdit(reservation, []), basis);
    assert.notEqual(
      fingerprintReservationEdit(reservation, [item, { ...item, id: "itm_b" }]),
      basis,
    );
  });
});

describe("compareReservationDemand", () => {
  const helmets = { productId: "helmet", quantity: 1 };
  const lines = [{ productId: "bike", quantity: 2 }, helmets, { productId: null, quantity: 1 }];
  const previous = { start: START, end: END, lines };
  const raised = (next: typeof previous) => [
    ...compareReservationDemand(previous, next).raisedProductIds,
  ];

  test("the same window and quantities change nothing", () => {
    const demand = compareReservationDemand(previous, { ...previous, lines: [...lines].reverse() });
    assert.equal(demand.changed, false);
    assert.equal(demand.raisedProductIds.size, 0);
  });

  test("a higher quantity or a new line raises that product only", () => {
    assert.deepEqual(
      raised({ ...previous, lines: [{ productId: "bike", quantity: 3 }, helmets] }),
      ["bike"],
    );
    assert.deepEqual(
      raised({ ...previous, lines: [...lines, { productId: "lock", quantity: 1 }] }),
      ["lock"],
    );
  });

  test("quantity moved between two lines of a product raises nothing", () => {
    const demand = compareReservationDemand(previous, {
      ...previous,
      lines: [{ productId: "bike", quantity: 1 }, { productId: "bike", quantity: 1 }, helmets],
    });
    assert.deepEqual(demand, { changed: false, raisedProductIds: new Set() });
  });

  test("quantity moved from one size to another asks more of that product", () => {
    const sized = (size: string, quantity: number) => ({
      productId: "wetsuit",
      quantity,
      combinationKey: `size:${size}`,
      selectedAttributes: { size },
    });
    const demand = compareReservationDemand(
      { start: START, end: END, lines: [sized("S", 2), sized("L", 1), helmets] },
      { start: START, end: END, lines: [sized("S", 1), sized("L", 2), helmets] },
    );
    assert.equal(demand.changed, true);
    assert.deepEqual([...demand.raisedProductIds], ["wetsuit"]);
  });

  test("a size lowered with nothing raised asks for no more", () => {
    const sized = (size: string, quantity: number) => ({
      productId: "wetsuit",
      quantity,
      combinationKey: `size:${size}`,
      selectedAttributes: { size },
    });
    const demand = compareReservationDemand(
      { start: START, end: END, lines: [sized("S", 2), sized("L", 1)] },
      { start: START, end: END, lines: [sized("S", 1), sized("L", 1)] },
    );
    assert.equal(demand.changed, true);
    assert.equal(demand.raisedProductIds.size, 0);
  });

  test("a lower quantity or a removed line changes the demand without raising it", () => {
    const demand = compareReservationDemand(previous, {
      ...previous,
      lines: [{ productId: "bike", quantity: 1 }],
    });
    assert.equal(demand.changed, true);
    assert.equal(demand.raisedProductIds.size, 0);
  });

  test("a window that reaches outside the previous one raises every product", () => {
    for (const next of [
      { ...previous, end: new Date(END.getTime() + DAY) },
      { ...previous, start: new Date(START.getTime() - DAY) },
      { ...previous, start: new Date(START.getTime() + DAY), end: new Date(END.getTime() + DAY) },
    ]) {
      assert.deepEqual(raised(next), ["bike", "helmet"]);
      assert.equal(compareReservationDemand(previous, next).changed, true);
    }
  });

  test("a shorter window inside the previous one raises nothing", () => {
    const demand = compareReservationDemand(previous, {
      ...previous,
      start: new Date(START.getTime() + DAY / 2),
      end: new Date(END.getTime() - DAY / 2),
    });
    assert.equal(demand.changed, true);
    assert.equal(demand.raisedProductIds.size, 0);
  });
});
