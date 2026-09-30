import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

import {
  canCustomerEditReservationDetails,
  fieldAppliesToProduct,
  hasCheckoutItemFields,
  itemFieldsForProduct,
  normalizeParticipantName,
  resolveCheckoutFields,
  toPublicCustomerField,
  validateCheckoutFieldValues,
  validateItemDetailUnits,
} from "./customer-fields-online";

let sequence = 0;

const definition = (overrides: Partial<CustomerFieldDefinition> = {}): CustomerFieldDefinition => {
  sequence += 1;
  return {
    id: `field${String(sequence).padStart(16, "0")}`,
    key: `field_${sequence}`,
    label: `Field ${sequence}`,
    type: "text",
    format: null,
    options: null,
    unit: null,
    helpText: null,
    section: "Section",
    position: sequence,
    width: "half",
    appliesTo: "all",
    isRequired: false,
    isSensitive: false,
    showOnContract: false,
    isSearchable: false,
    showInList: false,
    templateKey: null,
    isActive: true,
    scope: "customer",
    collectMode: "optional",
    targetMode: "all",
    customerEditable: false,
    targets: [],
    ...overrides,
  };
};

const SKIS = "cat_skis_000000000000";
const BIKES = "cat_bikes_00000000000";
const SKI = { id: "prod_ski_000000000000", categoryIds: [SKIS] };
const BIKE = { id: "prod_bike_00000000000", categoryIds: [BIKES] };
const HELMET = { id: "prod_helmet_000000000", categoryIds: [] };

describe("fieldAppliesToProduct", () => {
  test("`all` concerns every product, archived fields concern none", () => {
    assert.equal(fieldAppliesToProduct(definition(), HELMET), true);
    assert.equal(fieldAppliesToProduct(definition({ isActive: false }), HELMET), false);
  });

  test("`products` matches a targeted product or any of the product's categories", () => {
    const byProduct = definition({
      targetMode: "products",
      targets: [{ type: "product", id: BIKE.id }],
    });
    assert.equal(fieldAppliesToProduct(byProduct, BIKE), true);
    assert.equal(fieldAppliesToProduct(byProduct, SKI), false);

    const byCategory = definition({
      targetMode: "products",
      targets: [{ type: "category", id: SKIS }],
    });
    assert.equal(fieldAppliesToProduct(byCategory, SKI), true);
    // A secondary category (product_categories) counts as much as the primary one.
    assert.equal(
      fieldAppliesToProduct(byCategory, { id: BIKE.id, categoryIds: [BIKES, SKIS] }),
      true,
    );
    assert.equal(fieldAppliesToProduct(byCategory, BIKE), false);
  });

  test("`products` without a target applies to nothing", () => {
    assert.equal(fieldAppliesToProduct(definition({ targetMode: "products" }), SKI), false);
  });

  test("a category id never matches a product id and conversely", () => {
    const field = definition({
      targetMode: "products",
      targets: [{ type: "category", id: SKI.id }],
    });
    assert.equal(fieldAppliesToProduct(field, SKI), false);
  });
});

describe("resolveCheckoutFields", () => {
  const licence = definition({ label: "Licence", collectMode: "required" });
  const teamOnly = definition({ label: "Internal", collectMode: "never" });
  const accounting = definition({ appliesTo: "business" });
  const skiDocument = definition({
    targetMode: "products",
    targets: [{ type: "category", id: SKIS }],
  });
  const height = definition({
    scope: "item",
    collectMode: "required",
    targetMode: "products",
    targets: [{ type: "category", id: SKIS }],
  });
  const saddle = definition({
    scope: "item",
    targetMode: "products",
    targets: [{ type: "product", id: BIKE.id }],
  });
  const locker = definition({ scope: "item", collectMode: "never" });
  const archivedItem = definition({ scope: "item", isActive: false });
  const all = [licence, teamOnly, accounting, skiDocument, height, saddle, locker, archivedItem];

  const line = (product: { id: string; categoryIds: string[] }, quantity = 1) => ({
    productId: product.id,
    categoryIds: product.categoryIds,
    quantity,
  });

  test("asks customer fields once and item fields per matching line, in cart order", () => {
    const resolved = resolveCheckoutFields(
      all,
      [line(HELMET), line(SKI, 2), line(BIKE)],
      "individual",
    );

    assert.deepEqual(
      resolved.customerFields.map((field) => field.id),
      [licence.id, skiDocument.id],
    );
    assert.deepEqual(
      resolved.lines.map((entry) => entry.itemFields.map((field) => field.id)),
      [[], [height.id], [saddle.id]],
    );
    assert.equal(hasCheckoutItemFields(resolved), true);
  });

  test("a targeted customer field stays silent when no line concerns it", () => {
    const resolved = resolveCheckoutFields(all, [line(HELMET)], "individual");
    assert.deepEqual(
      resolved.customerFields.map((field) => field.id),
      [licence.id],
    );
    assert.equal(hasCheckoutItemFields(resolved), false);
  });

  test("appliesTo follows the checkout's customer type", () => {
    const business = resolveCheckoutFields(all, [line(HELMET)], "business");
    assert.deepEqual(
      business.customerFields.map((field) => field.id),
      [licence.id, accounting.id],
    );
  });

  test("team-only and archived fields are never asked", () => {
    const resolved = resolveCheckoutFields(all, [line(HELMET, 3)], "business");
    const asked = [
      ...resolved.customerFields,
      ...resolved.lines.flatMap((entry) => entry.itemFields),
    ];
    assert.equal(asked.includes(teamOnly), false);
    assert.equal(asked.includes(locker), false);
    assert.equal(asked.includes(archivedItem), false);
  });

  test("the team sees every applicable item field, asked or not", () => {
    assert.deepEqual(
      itemFieldsForProduct(all, SKI).map((field) => field.id),
      [height.id, locker.id],
    );
  });
});

describe("validateCheckoutFieldValues", () => {
  const licence = definition({ collectMode: "required" });
  const phone = definition({ type: "phone", collectMode: "optional" });
  const idNumber = definition({ isSensitive: true, collectMode: "optional" });
  const height = definition({ scope: "item", type: "number", collectMode: "required" });
  const level = definition({
    scope: "item",
    type: "select",
    options: ["Débutant", "Expert"],
    collectMode: "optional",
  });
  const fields = {
    customerFields: [licence, phone, idNumber],
    lines: [
      { quantity: 1, itemFields: [] },
      { quantity: 2, itemFields: [height, level] },
    ],
  };

  test("a required customer field must be filled", () => {
    const result = validateCheckoutFieldValues({
      fields,
      customerFields: { [licence.id]: "  " },
      itemDetails: [
        {
          lineIndex: 1,
          units: [{ values: { [height.id]: "172" } }, { values: { [height.id]: "150" } }],
        },
      ],
    });
    assert.deepEqual(result.issues, [
      { target: "customer", definitionId: licence.id, code: "required" },
    ]);
  });

  test("a required customer field left out is satisfied by a value on file, a blank is not", () => {
    const units = [{ values: { [height.id]: "172" } }, { values: { [height.id]: "150" } }];
    const omitted = validateCheckoutFieldValues({
      fields,
      customerFields: {},
      itemDetails: [{ lineIndex: 1, units }],
      existingCustomerValues: { [licence.id]: "B-1234" },
    });
    assert.deepEqual(omitted.issues, []);
    assert.deepEqual(omitted.customerValues, {});

    const blanked = validateCheckoutFieldValues({
      fields,
      customerFields: { [licence.id]: "" },
      itemDetails: [{ lineIndex: 1, units }],
      existingCustomerValues: { [licence.id]: "B-1234" },
    });
    assert.equal(blanked.issues.length, 1);
  });

  test("a required item field is checked on every unit of the line", () => {
    const result = validateCheckoutFieldValues({
      fields,
      customerFields: { [licence.id]: "B-1234" },
      itemDetails: [
        { lineIndex: 1, units: [{ participantName: " Léa ", values: { [height.id]: "172" } }] },
      ],
    });
    assert.deepEqual(result.issues, [
      { target: "item", lineIndex: 1, unitIndex: 1, definitionId: height.id, code: "required" },
    ]);
  });

  test("values are normalised, unknown and unasked values dropped, sensitive values kept as typed", () => {
    const stranger = definition({ collectMode: "optional" });
    const result = validateCheckoutFieldValues({
      fields,
      customerFields: {
        [licence.id]: " B-1234 ",
        [idNumber.id]: "AB 123 456",
        [stranger.id]: "not asked",
        unknown: "dropped",
      },
      itemDetails: [
        {
          lineIndex: 1,
          units: [
            { participantName: " Léa ", values: { [height.id]: "172,5", [stranger.id]: "x" } },
            { values: { [height.id]: "150", [level.id]: "Expert" } },
            { participantName: "Third unit", values: { [height.id]: "140" } },
          ],
        },
        { lineIndex: 0, units: [{ participantName: "No item field here", values: {} }] },
      ],
    });

    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.customerValues, {
      [licence.id]: "B-1234",
      [idNumber.id]: "AB 123 456",
    });
    assert.deepEqual(result.itemDetails, [
      {
        lineIndex: 1,
        units: [
          { unitIndex: 0, participantName: "Léa", values: { [height.id]: "172.5" } },
          {
            unitIndex: 1,
            participantName: null,
            values: { [height.id]: "150", [level.id]: "Expert" },
          },
        ],
      },
    ]);
  });

  test("an invalid value is reported with its code, per field and per unit", () => {
    const result = validateCheckoutFieldValues({
      fields,
      customerFields: { [licence.id]: "B-1234", [phone.id]: "abc" },
      itemDetails: [
        {
          lineIndex: 1,
          units: [
            { values: { [height.id]: "tall" } },
            { values: { [height.id]: "150", [level.id]: "Pro" } },
          ],
        },
      ],
    });
    assert.deepEqual(result.issues, [
      { target: "customer", definitionId: phone.id, code: "invalidPhone" },
      {
        target: "item",
        lineIndex: 1,
        unitIndex: 0,
        definitionId: height.id,
        code: "invalidNumber",
      },
      { target: "item", lineIndex: 1, unitIndex: 1, definitionId: level.id, code: "invalidOption" },
    ]);
  });

  test("an explicit blank on an optional customer field is kept as a request to clear", () => {
    const result = validateCheckoutFieldValues({
      fields: { customerFields: [phone], lines: [] },
      customerFields: { [phone.id]: "" },
    });
    assert.deepEqual(result.customerValues, { [phone.id]: "" });
  });

  test("empty units are listed so a rewrite can clear an earlier attempt", () => {
    const optionalOnly = { customerFields: [], lines: [{ quantity: 2, itemFields: [level] }] };
    const result = validateCheckoutFieldValues({ fields: optionalOnly });
    assert.deepEqual(result.itemDetails, [
      {
        lineIndex: 0,
        units: [
          { unitIndex: 0, participantName: null, values: {} },
          { unitIndex: 1, participantName: null, values: {} },
        ],
      },
    ]);
  });
});

describe("validateItemDetailUnits", () => {
  const height = definition({ scope: "item", type: "number", collectMode: "required" });
  const locker = definition({ scope: "item", collectMode: "never" });

  test("replaces the listed units for the writable fields and drops the rest", () => {
    const result = validateItemDetailUnits({
      fields: [height, locker],
      quantity: 2,
      units: [
        { unitIndex: 1, participantName: "  Tom ", values: { [locker.id]: "12", other: "x" } },
        { unitIndex: 5, values: { [height.id]: "180" } },
      ],
      enforceRequired: false,
    });
    assert.deepEqual(result, {
      units: [{ unitIndex: 1, participantName: "Tom", values: { [locker.id]: "12" } }],
      issues: [],
    });
  });

  test("a customer cannot empty a field asked as required, the team can", () => {
    const units = [{ unitIndex: 0, values: {} }];
    assert.deepEqual(
      validateItemDetailUnits({ fields: [height], quantity: 1, units, enforceRequired: true })
        .issues,
      [{ unitIndex: 0, definitionId: height.id, code: "required" }],
    );
    assert.deepEqual(
      validateItemDetailUnits({ fields: [height], quantity: 1, units, enforceRequired: false })
        .issues,
      [],
    );
  });
});

describe("storefront helpers", () => {
  test("the public shape never carries targets or team-only switches", () => {
    const field = toPublicCustomerField(
      definition({ targets: [{ type: "product", id: SKI.id }], isSearchable: true }),
    );
    assert.equal("targets" in field, false);
    assert.equal("isSearchable" in field, false);
    assert.equal("customerEditable" in field, false);
    // Forms lay it out by width; sections are gone.
    assert.equal(field.width, "half");
    assert.equal("section" in field, false);
  });

  test("participant names are trimmed and capped, blank means none", () => {
    assert.equal(normalizeParticipantName("  "), null);
    assert.equal(normalizeParticipantName(undefined), null);
    assert.equal(normalizeParticipantName(" Léa "), "Léa");
    assert.equal(normalizeParticipantName("x".repeat(150))?.length, 100);
  });

  test("a customer edits the details until the rental starts", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const later = new Date("2026-10-02T10:00:00Z");
    const earlier = new Date("2026-09-30T10:00:00Z");
    assert.equal(
      canCustomerEditReservationDetails({ status: "pending", startDate: later }, now),
      true,
    );
    assert.equal(
      canCustomerEditReservationDetails({ status: "confirmed", startDate: later }, now),
      true,
    );
    assert.equal(
      canCustomerEditReservationDetails({ status: "confirmed", startDate: earlier }, now),
      false,
    );
    for (const status of ["ongoing", "completed", "cancelled", "rejected", "declined"]) {
      assert.equal(canCustomerEditReservationDetails({ status, startDate: later }, now), false);
    }
  });
});
