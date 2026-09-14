import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./create-reservation.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source.slice(source.indexOf("export const createReservation =")).replace("export ", ""),
);

for (const mode of ["request", "payment", "payment-unavailable"]) {
  test(`${mode} checkout cannot log into the account of its unverified email`, async () => {
    let tokensIssued = 0;
    const prepared = {
      store: { id: "store", slug: "shop" },
      totals: {},
      insurance: { amount: 0, appliedOptIn: false },
      promo: null,
      delivery: {},
      cart: { lines: [] },
      window: { start: new Date(), end: new Date() },
      customerPhone: null,
    };
    const create = runInNewContext(`${compiled}; createReservation`, {
      checkMarketplaceCapability: async () => null,
      prepareReservation: async () => ({ ok: true, prepared }),
      writeReservation: async () => ({
        ok: true,
        replay: false,
        reused: false,
        reservationId: "booking",
        reservationNumber: "TEST-1",
        customerId: "existing-customer",
        customerEmail: "victim@example.test",
      }),
      getEffectiveReservationMode: () => (mode === "request" ? "request" : "payment"),
      runPostCreationEffects: async () => {},
      notifyRequestReceived: async () => {},
      startCheckoutPayment: async () =>
        mode === "payment" ? "https://checkout.example.test/session" : null,
      createReservationInstantAccessUrl: async () => {
        tokensIssued++;
        return "https://shop.example.test/r/booking?token=unsafe";
      },
      describeError: String,
      log: { error() {} },
      failReservation: (error) => ({ ok: false, error }),
    });
    const result = await create({
      source: "online",
      customer: { email: "victim@example.test", firstName: "Guest", lastName: "Checkout" },
      items: [{ quantity: 1 }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.customerId, "existing-customer");
    assert.equal(result.instantAccessUrl, null);
    assert.equal(tokensIssued, 0);
    assert.equal(
      result.paymentUrl,
      mode === "payment" ? "https://checkout.example.test/session" : null,
    );
  });
}
