import { createHmac, timingSafeEqual } from "node:crypto";

import { env as authEnv } from "@louez/auth/env";

/**
 * The pass that opens a store's storefront in test mode (packages/db
 * test-reservations.ts). The dashboard's session cookie does not reach the store's
 * own host, so the dashboard hands a signed, short-lived token to
 * `/{slug}/test-mode`, which turns it into the test-mode cookie. The token and the
 * cookie carry the same payload, bound to one store and to the owner who asked.
 */
export interface TestModePass {
  storeId: string;
  /** The dashboard user who started the test: the only person its messages go to. */
  userId: string;
  /** Expiry, in milliseconds since the epoch. */
  exp: number;
}

/** How long the storefront stays in test mode after the owner opens it. */
export const TEST_MODE_PASS_TTL_MS = 2 * 60 * 60 * 1000;

/** The storefront cookie holding the pass. */
export const TEST_MODE_COOKIE = "louez_test_mode";

const sign = (payload: string): string =>
  createHmac("sha256", `louez-test-mode:${authEnv.AUTH_SECRET}`)
    .update(payload)
    .digest("base64url");

export function createTestModePass(
  input: { storeId: string; userId: string },
  now: number = Date.now(),
): string {
  const pass: TestModePass = { ...input, exp: now + TEST_MODE_PASS_TTL_MS };
  const payload = Buffer.from(JSON.stringify(pass), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The pass, if the value is one signed here, unexpired, for this store. */
export function readTestModePass(
  value: string | null | undefined,
  storeId: string,
  now: number = Date.now(),
): TestModePass | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let pass: TestModePass;
  try {
    pass = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TestModePass;
  } catch {
    return null;
  }
  if (typeof pass.exp !== "number" || pass.exp < now) return null;
  if (pass.storeId !== storeId || typeof pass.userId !== "string") return null;
  return pass;
}
