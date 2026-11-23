import assert from "node:assert/strict";
import { test } from "node:test";

import { createDemoAddressSource, straightLineDistanceKm } from "./demo-addresses";
import { DEMO_VERTICALS } from "./verticals";

const addresses = DEMO_VERTICALS.evenementiel.deliveryAddresses;

test("whatever is typed, the trade's addresses are offered, matches first", async () => {
  const source = createDemoAddressSource(addresses);
  const anything = await source.search("12 avenue inconnue");
  assert.equal(anything.length, addresses.length);
  const vertou = await source.search("vertou");
  assert.match(vertou[0]!.description, /Vertou/);
  assert.deepEqual(await source.search("  "), []);
});

test("a picked address carries its coordinates, as the delivery needs", async () => {
  const source = createDemoAddressSource(addresses);
  const [first] = await source.search("a");
  const details = await source.details(first!.placeId);
  assert.ok(details && Number.isFinite(details.latitude) && Number.isFinite(details.longitude));
});

test("distances are straight lines, measured here", () => {
  const km = straightLineDistanceKm({
    originLatitude: 47.212,
    originLongitude: -1.65,
    destinationLatitude: 47.1662,
    destinationLongitude: -1.4583,
  });
  assert.ok(km > 10 && km < 20, String(km));
});
