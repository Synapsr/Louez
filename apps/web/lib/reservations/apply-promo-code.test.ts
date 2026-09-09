import assert from "node:assert/strict";
import { test } from "node:test";

import { MySqlDialect } from "drizzle-orm/mysql-core";

import type { Transaction } from "@louez/db";

import {
  buildConsumePromoCodeCondition,
  calculatePromoDiscount,
  consumePromoCode,
  evaluatePromoCode,
  type PromoCodeEvaluationRow,
} from "./apply-promo-code";

const NOW = new Date("2026-07-10T12:00:00.000Z");

const promo = (overrides: Partial<PromoCodeEvaluationRow> = {}): PromoCodeEvaluationRow => ({
  id: "promo_1",
  code: "SUMMER10",
  type: "percentage",
  value: "10.00",
  minimumAmount: null,
  maxUsageCount: null,
  currentUsageCount: 0,
  startsAt: null,
  expiresAt: null,
  ...overrides,
});

test("evaluatePromoCode: unknown code", () => {
  assert.deepEqual(evaluatePromoCode({ promo: null, subtotal: 100, now: NOW }), {
    ok: false,
    error: "errors.promoCodeInvalid",
  });
});

test("evaluatePromoCode: date window and usage cap, in the checkout's order", () => {
  assert.deepEqual(
    evaluatePromoCode({
      promo: promo({ startsAt: new Date("2026-08-01T00:00:00.000Z") }),
      subtotal: 100,
      now: NOW,
    }),
    { ok: false, error: "errors.promoCodeNotStarted" },
  );
  assert.deepEqual(
    evaluatePromoCode({
      promo: promo({ expiresAt: new Date("2026-07-01T00:00:00.000Z") }),
      subtotal: 100,
      now: NOW,
    }),
    { ok: false, error: "errors.promoCodeExpired" },
  );
  assert.deepEqual(
    evaluatePromoCode({
      promo: promo({ maxUsageCount: 3, currentUsageCount: 3 }),
      subtotal: 100,
      now: NOW,
    }),
    { ok: false, error: "errors.promoCodeExhausted" },
  );
  // Started, not yet expired, one use left: fine.
  assert.equal(
    evaluatePromoCode({
      promo: promo({
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        maxUsageCount: 3,
        currentUsageCount: 2,
      }),
      subtotal: 100,
      now: NOW,
    }).ok,
    true,
  );
});

test("evaluatePromoCode: minimum amount is checked on the subtotal, with the amount as a 2-decimal string", () => {
  assert.deepEqual(
    evaluatePromoCode({ promo: promo({ minimumAmount: "150.5" }), subtotal: 100, now: NOW }),
    {
      ok: false,
      error: "errors.promoCodeMinimumNotMet",
      params: { amount: "150.50" },
    },
  );
  const met = evaluatePromoCode({
    promo: promo({ minimumAmount: "100" }),
    subtotal: 100,
    now: NOW,
  });
  assert.ok(met.ok);
  assert.equal(met.minimumAmount, 100);
});

test("evaluatePromoCode: percentage discount rounded to the cent, with the snapshot", () => {
  const result = evaluatePromoCode({
    promo: promo({ value: "15.00" }),
    subtotal: 33.33,
    now: NOW,
  });
  assert.deepEqual(result, {
    ok: true,
    promoCodeId: "promo_1",
    discountAmount: 5, // 4.9995 → 5.00
    minimumAmount: 0,
    snapshot: { code: "SUMMER10", type: "percentage", value: 15 },
  });
});

test("evaluatePromoCode: fixed discount is capped at the subtotal", () => {
  const result = evaluatePromoCode({
    promo: promo({ type: "fixed", value: "9999.00" }),
    subtotal: 42.1,
    now: NOW,
  });
  assert.ok(result.ok);
  assert.equal(result.discountAmount, 42.1);
  assert.equal(calculatePromoDiscount({ type: "fixed", value: "25" }, 100), 25);
  assert.equal(calculatePromoDiscount({ type: "percentage", value: "100" }, 80), 80);
});

test("consumePromoCode: the guarded UPDATE only touches an active code below its cap", () => {
  const dialect = new MySqlDialect();
  const { sql, params } = dialect.sqlToQuery(buildConsumePromoCodeCondition("promo_1"));

  assert.match(sql, /`promo_codes`\.`id` = \?/);
  assert.match(sql, /`promo_codes`\.`is_active` = \?/);
  assert.match(sql, /`promo_codes`\.`max_usage_count` is null/);
  assert.match(sql, /`promo_codes`\.`current_usage_count` < `promo_codes`\.`max_usage_count`/);
  assert.deepEqual(params, ["promo_1", true]);
});

const fakeUpdateTransaction = (affectedRows: number): Pick<Transaction, "update"> => {
  const chain = {
    set: () => chain,
    where: async () => [{ affectedRows }],
  };
  // Test double: only the update → set → where chain of the transaction is exercised.
  return { update: () => chain } as unknown as Pick<Transaction, "update">;
};

test("consumePromoCode: zero affected rows means the last use was taken concurrently", async () => {
  assert.equal(await consumePromoCode(fakeUpdateTransaction(1), "promo_1"), true);
  assert.equal(await consumePromoCode(fakeUpdateTransaction(0), "promo_1"), false);
});
