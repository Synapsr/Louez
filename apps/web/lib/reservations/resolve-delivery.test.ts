import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Delivery of a demo store (lib/demo) is never routed: no paid routing call,
// a straight line. Any other store is routed as before.

const routed: unknown[] = [];
mock.module("@louez/api/services", {
  namedExports: {
    getRouteDistance: async (params: unknown) => {
      routed.push(params);
      return { distanceKm: 12, source: "route" };
    },
  },
});
mock.module("@louez/api/services/location-snapshots", {
  namedExports: { resolveReservationLocationSnapshot: async () => null },
});

const loadResolveDelivery = async () => (await import("./resolve-delivery")).resolveDelivery;

const settings = {
  enabled: true,
  mode: "optional" as const,
  pricePerKm: 1.2,
  minimumFee: 25,
  maximumDistance: 40,
  freeDeliveryThreshold: null,
};
const leg = {
  method: "address" as const,
  address: "Domaine de la Chênaie, route de la Loire",
  city: "Vertou",
  postalCode: "44120",
  latitude: 47.1662,
  longitude: -1.4583,
};
const store = (demoVertical: string | null) => ({
  id: "store_1",
  name: "Les Jolis Jours",
  address: "12 rue des Ateliers, 44800 Saint-Herblain",
  latitude: "47.2120000",
  longitude: "-1.6500000",
  settings: { country: "FR" },
  demoVertical,
});

test("a demo store's delivery is measured in a straight line, never routed", async () => {
  const resolveDelivery = await loadResolveDelivery();
  routed.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("no network call from a demo store's delivery");
  }) as typeof fetch;
  try {
    const result = await resolveDelivery({
      store: store("evenementiel"),
      settings,
      delivery: { outbound: leg, return: leg },
      subtotal: 600,
    });
    assert.equal(result.ok, true);
    assert.equal(routed.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("any other store's delivery is routed", async () => {
  const resolveDelivery = await loadResolveDelivery();
  routed.length = 0;
  const result = await resolveDelivery({
    store: store(null),
    settings,
    delivery: { outbound: leg, return: leg },
    subtotal: 600,
  });
  assert.equal(result.ok, true);
  assert.equal(routed.length, 2);
});
