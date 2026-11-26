import assert from "node:assert/strict";
import { test } from "node:test";

import type { CustomItem } from "../types";
import {
  customItemFormFromItem,
  type CustomItemFormValues,
  emptyCustomItemForm,
  followingPrice,
  resolveCustomItemForm,
  totalFromUnitPrice,
  unitPriceFromTotal,
} from "./custom-item-form";

// A custom item on a new reservation, priced over three days: typed as a
// total or per unit, the field typed in last sets the unit price, and the
// other one follows it.

const THREE_DAYS = 3;

const form = (patch: Partial<CustomItemFormValues>): CustomItemFormValues => ({
  ...emptyCustomItemForm,
  name: "Vintage sound console",
  ...patch,
});

const sound: CustomItem = {
  id: "custom-sound",
  name: "Vintage sound console",
  description: "With its cables",
  unitPrice: 100 / 3,
  deposit: 150,
  quantity: 1,
  pricingMode: "day",
  basePeriodMinutes: 1440,
};

test("a total is spread over the quantity and the duration, exactly", () => {
  const result = resolveCustomItemForm(
    form({ totalPrice: "100", quantity: "2", priceField: "total" }),
    THREE_DAYS,
  );
  assert.ok(result.ok);
  assert.equal(result.values.unitPrice, 100 / 6);
  assert.equal(result.values.quantity, 2);
  assert.equal(result.values.basePeriodMinutes, 1440);
});

test("a unit price is kept as typed", () => {
  const result = resolveCustomItemForm(
    form({ unitPrice: "12.5", totalPrice: "999", priceField: "unit", pricingMode: "week" }),
    THREE_DAYS,
  );
  assert.ok(result.ok);
  assert.equal(result.values.unitPrice, 12.5);
  assert.equal(result.values.pricingMode, "week");
  assert.equal(result.values.basePeriodMinutes, 10080);
});

test("the name and description are trimmed, an empty deposit is none", () => {
  const result = resolveCustomItemForm(
    form({ name: "  Stage  ", description: " Wooden ", totalPrice: "30" }),
    THREE_DAYS,
  );
  assert.ok(result.ok);
  assert.deepEqual(
    [result.values.name, result.values.description, result.values.deposit],
    ["Stage", "Wooden", 0],
  );
});

test("with a period, the price is checked before the name", () => {
  assert.deepEqual(resolveCustomItemForm(form({ name: " ", totalPrice: "" }), THREE_DAYS), {
    ok: false,
    errors: ["priceRequired", "nameRequired"],
  });
  assert.deepEqual(resolveCustomItemForm(form({ totalPrice: "-4" }), THREE_DAYS), {
    ok: false,
    errors: ["priceRequired"],
  });
  assert.deepEqual(
    resolveCustomItemForm(form({ unitPrice: "0", priceField: "unit" }), THREE_DAYS),
    { ok: false, errors: ["priceRequired"] },
  );
});

test("adding requires a period for both price fields", () => {
  const missingPeriod = { ok: false, errors: ["selectPeriodFirst"] };
  assert.deepEqual(resolveCustomItemForm(form({ totalPrice: "40" }), 0), missingPeriod);
  assert.deepEqual(
    resolveCustomItemForm(form({ unitPrice: "12.5", priceField: "unit" }), 0),
    missingPeriod,
  );
});

test("the price that follows: a total stays and its unit price moves, or the other way round", () => {
  assert.deepEqual(
    followingPrice(form({ totalPrice: "90", quantity: "2", priceField: "total" }), THREE_DAYS),
    { field: "unitPrice", value: "15.00" },
  );
  assert.deepEqual(
    followingPrice(form({ unitPrice: "10", quantity: "2", priceField: "unit" }), THREE_DAYS),
    { field: "totalPrice", value: "60.00" },
  );
  assert.equal(unitPriceFromTotal("90", "1", 0), "");
  assert.equal(totalFromUnitPrice("", "1", THREE_DAYS), "");
});

test("an item opens with its values, its total from its exact unit price", () => {
  assert.deepEqual(customItemFormFromItem(sound, THREE_DAYS), {
    name: "Vintage sound console",
    description: "With its cables",
    unitPrice: "33.33",
    totalPrice: "100.00",
    deposit: "150",
    quantity: "1",
    pricingMode: "day",
    priceField: "total",
  });
  assert.equal(customItemFormFromItem(sound, 0).totalPrice, "");
});

test("an item edited without touching its price keeps its exact unit price", () => {
  const opened = customItemFormFromItem(sound, THREE_DAYS);
  const origin = { item: sound, form: opened };

  const renamed = resolveCustomItemForm({ ...opened, name: "Sound console" }, THREE_DAYS, origin);
  assert.ok(renamed.ok);
  assert.equal(renamed.values.unitPrice, sound.unitPrice);
  assert.equal(renamed.values.name, "Sound console");

  // Another quantity is priced from the total shown, as when adding.
  const doubled = resolveCustomItemForm(
    { ...opened, quantity: "2", unitPrice: "16.67" },
    THREE_DAYS,
    origin,
  );
  assert.ok(doubled.ok);
  assert.equal(doubled.values.unitPrice, 100 / 6);
});

test("editing requires a period even when the pricing fields are unchanged", () => {
  const opened = customItemFormFromItem(sound, 0);
  const origin = { item: sound, form: opened };
  const missingPeriod = { ok: false, errors: ["selectPeriodFirst"] };

  assert.deepEqual(resolveCustomItemForm({ ...opened, name: "Console" }, 0, origin), missingPeriod);
  assert.deepEqual(
    resolveCustomItemForm({ ...opened, totalPrice: "40" }, 0, origin),
    missingPeriod,
  );
  assert.deepEqual(
    resolveCustomItemForm({ ...opened, unitPrice: "12.5", priceField: "unit" }, 0, origin),
    missingPeriod,
  );
});
