import assert from "node:assert/strict";
import test from "node:test";

import { authIpAddressOptions, authRateLimitOptions } from "./rate-limit";

// Mirrors better-auth's lookup: the FIRST key that matches wins, and `*`
// stands for exactly one path segment.
const resolveRule = (path: string) => {
  const key = Object.keys(authRateLimitOptions.customRules).find((pattern) =>
    pattern.includes("*")
      ? new RegExp(`^${pattern.replaceAll("*", "[^/]+")}$`).test(path)
      : pattern === path,
  );
  return Object.entries(authRateLimitOptions.customRules).find(([pattern]) => pattern === key)?.[1];
};

test("counts in the database, in every environment", () => {
  assert.equal(authRateLimitOptions.enabled, true);
  assert.equal(authRateLimitOptions.storage, "database");
});

test("throttles every endpoint that guesses a password or a code", () => {
  for (const path of [
    "/sign-in/email",
    "/sign-in/email-otp",
    "/sign-up/email",
    "/change-password",
    "/email-otp/reset-password",
    "/email-otp/check-verification-otp",
    "/reset-password/some-token",
  ]) {
    assert.deepEqual(resolveRule(path), { window: 60, max: 5 }, path);
  }
});

test("throttles harder the endpoints that send an e-mail", () => {
  for (const path of [
    "/email-otp/send-verification-otp",
    "/email-otp/request-password-reset",
    "/forget-password/email-otp",
    "/request-password-reset",
    "/sign-in/magic-link",
    "/delete-user",
  ]) {
    assert.deepEqual(resolveRule(path), { window: 60, max: 3 }, path);
  }
});

test("leaves ordinary endpoints on the default limit", () => {
  assert.equal(resolveRule("/get-session"), undefined);
  assert.equal(resolveRule("/sign-out"), undefined);
});

test("resolves the client IP like the rest of the app, most specific header first", () => {
  assert.deepEqual(authIpAddressOptions.ipAddressHeaders, [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ]);
});
