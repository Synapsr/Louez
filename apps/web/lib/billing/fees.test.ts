import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { z } from "zod";

import { policyInvoicing } from "@louez/db";

import { policyApplicationFee, policyPaymentKind } from "@/lib/billing-sync/policies";

import { type FeeCharge, type FeePolicy, commission, feeAtSource } from "./fees";

// fees.md §7 and §8 on the contract's public vectors (commission-01 to commission-08 and
// the 31 public source-* vectors, copied into lib/billing-sync/fee-vectors.public.json).
// The policies parse with Louez's own policy schema, so each one is a policy Louez would
// store. The others use the launch values and stay in the service (Q33).

const amount = z.number().int();
const commissionVector = z.object({
  id: z.string(),
  function: z.literal("commission"),
  input: z.object({
    base: amount,
    terms: z.object({ rateBps: amount, minMinor: amount, maxMinor: amount.nullable() }),
  }),
  expected: amount,
});
const sourceVector = z.object({
  id: z.string(),
  function: z.literal("feeAtSource"),
  input: z.object({
    policy: z.object({
      invoicing: policyInvoicing,
      currency: z.string(),
      applicationFee: policyApplicationFee,
      marketplaceFeeMinor: amount,
    }),
    payment: z.object({
      chargeMinor: amount,
      currency: z.string(),
      kind: policyPaymentKind,
      insuranceShareMinor: amount,
      isMarketplace: z.boolean(),
      marketplaceWaived: z.boolean(),
      marketplaceAlreadyTaken: z.boolean(),
      reservationAlreadyBillable: z.boolean(),
      reservationFeeAlreadyTaken: z.boolean(),
    }),
  }),
  expected: z.object({
    totalMinor: amount,
    reservationMinor: amount,
    marketplaceMinor: amount,
    baseMinor: amount,
  }),
});

const all = z
  .object({ vectors: z.array(z.object({ function: z.string() }).passthrough()) })
  .parse(
    JSON.parse(
      readFileSync(new URL("../billing-sync/fee-vectors.public.json", import.meta.url), "utf8"),
    ),
  ).vectors;
const commissionVectors = all
  .filter((vector) => vector.function === "commission")
  .map((vector) => commissionVector.parse(vector));
const sourceVectors = all
  .filter((vector) => vector.function === "feeAtSource")
  .map((vector) => sourceVector.parse(vector));

const ids = (prefix: string, numbers: readonly number[]) =>
  numbers.map((n) => `${prefix}-${String(n).padStart(2, "0")}`);

describe("commission vectors", () => {
  test("the eight public ones are present", () => {
    assert.deepEqual(
      commissionVectors.map((vector) => vector.id),
      ids("commission", [1, 2, 3, 4, 5, 6, 7, 8]),
    );
  });

  for (const vector of commissionVectors) {
    test(vector.id, () => {
      assert.equal(commission(vector.input.base, vector.input.terms), vector.expected);
    });
  }
});

describe("feeAtSource vectors", () => {
  test("the 31 public ones are present", () => {
    const numbers = [...Array.from({ length: 29 }, (_, index) => index + 1), 38, 39];
    assert.deepEqual(
      sourceVectors.map((vector) => vector.id),
      ids("source", numbers),
    );
  });

  for (const vector of sourceVectors) {
    test(vector.id, () => {
      assert.deepEqual(feeAtSource(vector.input.policy, vector.input.payment), vector.expected);
    });
  }
});

describe("feeAtSource beyond the vectors", () => {
  const charge: FeeCharge = {
    chargeMinor: 20_000,
    currency: "EUR",
    kind: "rental",
    insuranceShareMinor: 0,
    isMarketplace: true,
    marketplaceWaived: false,
    marketplaceAlreadyTaken: false,
    reservationAlreadyBillable: false,
    reservationFeeAlreadyTaken: false,
  };
  const percent: Extract<FeePolicy["applicationFee"], { kind: "percent" }> = {
    kind: "percent",
    rateBps: 123,
    minMinor: 0,
    maxMinor: null,
    excludeInsurance: true,
    appliesTo: ["rental"],
  };

  test("louez_legacy takes nothing: the legacy planner decides", () => {
    assert.deepEqual(
      feeAtSource(
        {
          invoicing: "louez_legacy",
          currency: "EUR",
          applicationFee: percent,
          marketplaceFeeMinor: 150,
        },
        charge,
      ),
      { totalMinor: 0, reservationMinor: 0, marketplaceMinor: 0, baseMinor: 0 },
    );
  });

  test("built-in terms with no currency skip the flat amounts and keep the percent", () => {
    assert.deepEqual(
      feeAtSource(
        { invoicing: "service", currency: null, applicationFee: percent, marketplaceFeeMinor: 150 },
        charge,
      ),
      { totalMinor: 246, reservationMinor: 246, marketplaceMinor: 0, baseMinor: 20_000 },
    );
  });

  // No public vector has a percent that keeps the insurance in its base.
  test("a percent without excludeInsurance keeps the insurance share in its base", () => {
    assert.deepEqual(
      feeAtSource(
        {
          invoicing: "service",
          currency: "EUR",
          applicationFee: { ...percent, excludeInsurance: false },
          marketplaceFeeMinor: 0,
        },
        { ...charge, insuranceShareMinor: 5_000 },
      ),
      { totalMinor: 246, reservationMinor: 246, marketplaceMinor: 0, baseMinor: 20_000 },
    );
  });

  test("an insurance share above the charge leaves a base of 0", () => {
    assert.deepEqual(
      feeAtSource(
        {
          invoicing: "service",
          currency: "EUR",
          applicationFee: { ...percent, minMinor: 50 },
          marketplaceFeeMinor: 0,
        },
        { ...charge, insuranceShareMinor: 25_000 },
      ),
      { totalMinor: 0, reservationMinor: 0, marketplaceMinor: 0, baseMinor: 0 },
    );
  });
});
