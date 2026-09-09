import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStoreReassurance } from "./util.store-reassurance";

const chargeable = { stripeAccountId: "acct_1", stripeChargesEnabled: true };

describe("getStoreReassurance", () => {
  it("promises instant confirmation and secure payment when Stripe can charge", () => {
    assert.deepEqual(
      getStoreReassurance({ settings: { reservationMode: "payment" }, ...chargeable }),
      ["instantConfirmation", "securePayment", "localPickup"],
    );
  });

  it("falls back to a request when payment mode has no chargeable Stripe account", () => {
    assert.deepEqual(
      getStoreReassurance({
        settings: { reservationMode: "payment" },
        stripeChargesEnabled: false,
      }),
      ["requestConfirmation", "localPickup"],
    );
  });

  it("says request in request mode even with Stripe", () => {
    assert.deepEqual(
      getStoreReassurance({ settings: { reservationMode: "request" }, ...chargeable }),
      ["requestConfirmation", "localPickup"],
    );
  });

  it("mentions delivery only when it is enabled", () => {
    const settings = {
      reservationMode: "request" as const,
      delivery: {
        enabled: true,
        mode: "optional" as const,
        pricePerKm: 1,
        minimumFee: 5,
        maximumDistance: null,
        freeDeliveryThreshold: null,
      },
    };
    const [, last] = getStoreReassurance({ settings });
    assert.equal(last, "localPickupOrDelivery");
  });

  it("handles a store without settings", () => {
    assert.deepEqual(getStoreReassurance({ settings: null }), [
      "requestConfirmation",
      "localPickup",
    ]);
  });
});
