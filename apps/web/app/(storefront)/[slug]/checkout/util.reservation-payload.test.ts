import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomerFieldPublic } from "@louez/validations";
import { createReservationInputSchema } from "@louez/validations";

import type { CartItem } from "@/contexts/cart-context";

import type { CheckoutFieldsPlan, DeliveryAddress } from "./checkout.types";
import { toUnitKey } from "./util.checkout-custom-fields";
import { buildReservationPayload } from "./util.reservation-payload";
import { CHECKOUT_DEFAULT_VALUES } from "./validator.checkout";

const NO_ADDRESS: DeliveryAddress = {
  address: "",
  city: "",
  postalCode: "",
  country: "FR",
  latitude: null,
  longitude: null,
};

const bike: CartItem = {
  lineId: "line-bike",
  selectionSignature: "__default",
  productId: "bike0000000000000001",
  productName: "Fat bike",
  productImage: null,
  price: 38,
  deposit: 0,
  quantity: 2,
  maxQuantity: 5,
  pricingKind: "duration",
  startDate: "2026-10-20T09:00:00.000Z",
  endDate: "2026-10-22T09:00:00.000Z",
  pricingMode: "day",
};

const field = (id: string, scope: "customer" | "item"): CustomerFieldPublic => ({
  id,
  label: id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  position: 0,
  width: "half",
  scope,
  collectMode: "optional",
  isSensitive: false,
});

const build = (checkoutFields?: CheckoutFieldsPlan) =>
  buildReservationPayload({
    storeId: "store000000000000001",
    locale: "fr",
    values: {
      ...CHECKOUT_DEFAULT_VALUES,
      email: "lea@example.test",
      firstName: "Léa",
      lastName: "Essai",
      phone: "+33612345678",
      profileFields: {
        birthDate: "1990-05-17",
        acquisitionSource: { source: "walk_in", detail: "left behind" },
        socialLinks: { instagram: "@lea", website: " " },
      },
      customerFields: { "id-number": "AB123" },
      itemDetails: {
        [toUnitKey("line-bike", 1)]: { participantName: "Tom", values: { height: "180" } },
      },
    },
    items: [bike],
    subtotalAmount: 152,
    depositAmount: 0,
    totalAmount: 152,
    outboundMethod: "store",
    outboundAddress: NO_ADDRESS,
    returnMethod: "store",
    returnAddress: NO_ADDRESS,
    tulipInsuranceMode: "no_public",
    checkoutFields,
  });

describe("buildReservationPayload custom fields", () => {
  it("carries what the cart asks, in the shape the server accepts", () => {
    const payload = build({
      profileFields: [
        { key: "birthDate", collectMode: "required" },
        { key: "acquisitionSource", collectMode: "optional" },
      ],
      customerFields: [field("id-number", "customer")],
      customerLayout: [],
      lines: [
        {
          lineId: "line-bike",
          productName: "Fat bike",
          productImage: null,
          quantity: 2,
          itemFields: [field("height", "item")],
        },
      ],
    });

    // Only the asked native fields travel; the detail stays behind a source without one.
    assert.deepEqual(payload.profileFields, {
      birthDate: "1990-05-17",
      acquisitionSource: "walk_in",
    });
    assert.deepEqual(payload.customerFields, { "id-number": "AB123" });
    assert.deepEqual(payload.itemDetails, [
      {
        lineIndex: 0,
        units: [{ values: {} }, { participantName: "Tom", values: { height: "180" } }],
      },
    ]);
    assert.equal(createReservationInputSchema.safeParse(payload).success, true);
  });

  it("leaves the keys out when nothing is asked", () => {
    const payload = build({ profileFields: [], customerFields: [], customerLayout: [], lines: [] });
    assert.equal("profileFields" in payload, false);
    assert.equal("customerFields" in payload, false);
    assert.equal("itemDetails" in payload, false);
    assert.equal("customerFields" in build(), false);
  });
});
