import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CURRENCY_SYMBOLS,
  SUPPORTED_CURRENCIES,
  getYearlyPrice,
  isPlanAvailable,
  type Plan,
} from "@/lib/plans.shared";

test("keeps subscription management out of the server plan module graph", async () => {
  const source = await readFile(new URL("./subscription-management.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /import\s*\{[\s\S]*?\}\s*from\s*["']@\/lib\/plans["']/,
    "client code must not import runtime values from server plan config",
  );
});

test("keeps subscription plan display helpers client-safe", () => {
  const plan = {
    price: 49,
    stripePrices: {
      eur: { monthly: "price_monthly", yearly: "price_yearly" },
      usd: {},
    },
  } satisfies Pick<Plan, "price" | "stripePrices">;

  assert.deepEqual(SUPPORTED_CURRENCIES, ["eur", "usd"]);
  assert.equal(CURRENCY_SYMBOLS.eur, "€");
  assert.equal(getYearlyPrice(plan), 490);
  assert.equal(isPlanAvailable(plan, "monthly", "eur"), true);
  assert.equal(isPlanAvailable(plan, "monthly", "usd"), false);
});
