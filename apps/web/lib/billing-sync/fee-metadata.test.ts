import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFeeMetadataV4, readFeeMetadata } from "./fee-metadata";

test("v4 metadata round-trips, zero fees included", () => {
  const metadata = buildFeeMetadataV4({
    totalMinor: 0,
    reservationMinor: 0,
    marketplaceMinor: 0,
    baseMinor: 0,
    insuranceShareMinor: 120,
    policyScope: "legacy",
    policyVersion: 0,
    paymentKind: "rental",
    reservationId: "r1",
    storeId: "s1",
  });
  assert.equal(metadata.louezFeeV, "4");
  assert.ok(Object.values(metadata).every((value) => typeof value === "string"));
  assert.deepEqual(readFeeMetadata(metadata), {
    metadataVersion: 4,
    totalMinor: 0,
    reservationMinor: 0,
    marketplaceMinor: 0,
    baseMinor: 0,
    insuranceShareMinor: 120,
    policyScope: "legacy",
    policyVersion: 0,
    paymentKind: "rental",
  });
});

test("v3 metadata is still read, with no insurance share", () => {
  const facts = readFeeMetadata({
    platformFeeVersion: "3",
    platformReservationFeeCents: "25",
    platformMarketplaceFeeCents: "100",
  });
  assert.equal(facts?.metadataVersion, 3);
  assert.equal(facts?.totalMinor, 125);
  assert.equal(facts?.insuranceShareMinor, null);
});

test("no fee metadata reads as null, and malformed v4 is refused", () => {
  assert.equal(readFeeMetadata({ reservationId: "r1" }), null);
  assert.equal(readFeeMetadata({ louezFeeV: "4", louezFeeTotalMinor: "1.5" }), null);
});
