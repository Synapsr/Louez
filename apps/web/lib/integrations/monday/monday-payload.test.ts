process.env.SKIP_ENV_VALIDATION = "true";

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildMondayMainItemTitle,
  buildMondaySubitemPayload,
  classifyReservationItemKind,
  getMondayStatusLabelForLouezStatus,
  isCancelledReservationStatus,
  resolveLouezStatusFromMondayLabel,
} from "./monday-payload";

describe("monday-payload", () => {
  const baseCustomer = {
    customerType: "individual" as const,
    firstName: "Jan",
    lastName: "Kowalski",
    companyName: null,
    email: "jan@example.com",
    phone: "+48123456789",
  };

  test("classifies rooms vs equipment products accurately", () => {
    const roomByCategory = classifyReservationItemKind({
      id: "item-1",
      quantity: 1,
      productSnapshot: { name: "Sala Konferencyjna A" },
      selectedAttributes: null,
      product: {
        name: "Sala Konferencyjna A",
        category: { name: "Pomieszczenia", slug: "pomieszczenia" },
        categoryLinks: [],
      },
      assignedUnits: [],
    });

    const roomByStudioName = classifyReservationItemKind({
      id: "item-2",
      quantity: 1,
      productSnapshot: { name: "Studio Daylight" },
      selectedAttributes: null,
      product: null,
      assignedUnits: [],
    });

    const equipmentProduct = classifyReservationItemKind({
      id: "item-3",
      quantity: 2,
      productSnapshot: { name: "Sony FX3" },
      selectedAttributes: { mount: "E-Mount" },
      product: {
        name: "Sony FX3",
        category: { name: "Kamery", slug: "kamery" },
        categoryLinks: [],
      },
      assignedUnits: [{ identifierSnapshot: "#FX3-01" }, { identifierSnapshot: "#FX3-02" }],
    });

    assert.equal(roomByCategory, "room");
    assert.equal(roomByStudioName, "room");
    assert.equal(equipmentProduct, "product");
  });

  test("formats subitem payload with room/product prefix, quantity, attributes and units", () => {
    const subitem = buildMondaySubitemPayload(
      {
        id: "item-3",
        quantity: 2,
        productSnapshot: { name: "Sony FX3" },
        selectedAttributes: { mount: "E-Mount" },
        product: null,
        assignedUnits: [{ identifierSnapshot: "#FX3-01" }, { identifierSnapshot: "#FX3-02" }],
      },
      {
        subitemQuantityColumnId: "numbers_qty",
        subitemTypeColumnId: "text_type",
        subitemUnitsColumnId: "text_units",
      },
    );

    assert.equal(subitem.itemKind, "product");
    assert.equal(
      subitem.name,
      "[SPRZĘT] Sony FX3 (E-Mount) (x2) [Jednostki: #FX3-01, #FX3-02]",
    );
    assert.deepEqual(subitem.columnValues, {
      numbers_qty: "2",
      text_type: "Sprzęt",
      text_units: "#FX3-01, #FX3-02",
    });
  });

  test("maps Louez statuses to Monday labels and back (including Polish diacritics normalization)", () => {
    assert.equal(getMondayStatusLabelForLouezStatus("confirmed"), "Gotowa do wydania");
    assert.equal(getMondayStatusLabelForLouezStatus("ongoing"), "Wydana");
    assert.equal(getMondayStatusLabelForLouezStatus("completed"), "Zakończona");
    assert.equal(getMondayStatusLabelForLouezStatus("cancelled"), "Anulowane");

    assert.equal(resolveLouezStatusFromMondayLabel("Gotowa do wydania"), "confirmed");
    assert.equal(resolveLouezStatusFromMondayLabel("Potwierdzona"), "confirmed");
    assert.equal(resolveLouezStatusFromMondayLabel("Wydana"), "ongoing");
    assert.equal(resolveLouezStatusFromMondayLabel("Zakończona"), "completed");
    assert.equal(resolveLouezStatusFromMondayLabel("zakonczona"), "completed");
    assert.equal(resolveLouezStatusFromMondayLabel("Anulowane"), "cancelled");
  });

  test("identifies cancelled reservation statuses so items are never deleted automatically", () => {
    assert.equal(isCancelledReservationStatus("cancelled"), true);
    assert.equal(isCancelledReservationStatus("rejected"), true);
    assert.equal(isCancelledReservationStatus("declined"), true);
    assert.equal(isCancelledReservationStatus("confirmed"), false);
    assert.equal(isCancelledReservationStatus("ongoing"), false);
  });

  test("builds main item title with reservation number, internal title, and customer name", () => {
    const titleWithInternal = buildMondayMainItemTitle({
      id: "res-1",
      storeId: "store-1",
      number: "2026-0042",
      internalTitle: "Plan zdjęciowy reklama",
      bookedByName: null,
      status: "confirmed",
      startDate: new Date("2026-11-20T08:00:00Z"),
      endDate: new Date("2026-11-21T18:00:00Z"),
      totalAmount: "1500.00",
      customerNotes: null,
      internalNotes: null,
      outboundMethod: "store",
      returnMethod: "store",
      deliveryAddress: null,
      deliveryCity: null,
      deliveryPostalCode: null,
      deliveryCountry: null,
      returnAddress: null,
      returnCity: null,
      returnPostalCode: null,
      returnCountry: null,
      pickupLocationSnapshot: null,
      returnLocationSnapshot: null,
      store: { name: "Studio", address: null },
      customer: baseCustomer,
      items: [],
    });

    assert.equal(titleWithInternal, "[2026-0042] Plan zdjęciowy reklama — Jan Kowalski");
  });
});
