import assert from "node:assert/strict";
import { test } from "node:test";

import { decideMarketplaceFeeRecord } from "./marketplace-fee-core";

test("marketplace fee recording is idempotent for an existing dedup row", () => {
  const first = decideMarketplaceFeeRecord({
    existing: null,
    hasLifetimeWaiver: false,
    source: "manual",
    collectedAmountCents: 0,
  });
  assert.deepEqual(first, {
    action: "insert",
    amountCents: 100,
    source: "marketplace_manual",
    status: "pending",
  });

  const duplicate = decideMarketplaceFeeRecord({
    existing: { source: "marketplace_manual", status: "pending" },
    hasLifetimeWaiver: false,
    source: "manual",
    collectedAmountCents: 0,
  });
  assert.deepEqual(duplicate, { action: "skip", reason: "already_recorded" });
});

test("launch-cohort marketplace fees are recorded as settled waived rows", () => {
  assert.deepEqual(
    decideMarketplaceFeeRecord({
      existing: null,
      hasLifetimeWaiver: true,
      source: "online",
      collectedAmountCents: 0,
    }),
    {
      action: "insert",
      amountCents: 0,
      source: "marketplace_waived",
      status: "collected",
      reason: "lifetime_waiver",
    },
  );
});
