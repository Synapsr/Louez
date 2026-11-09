import assert from "node:assert/strict";
import test from "node:test";

import { trustedProxySchema, type TrustedProxy } from "./env";
import {
  authIpAddressOptions,
  authRateLimitOptions,
  authRateLimitOptionsBehind,
} from "./rate-limit";

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

test("throttles every public ceremony and passkey mutation using the shared database counters", () => {
  for (const path of [
    "/passkey/generate-register-options",
    "/passkey/verify-registration",
    "/passkey/delete-passkey",
    "/passkey/update-passkey",
  ]) {
    assert.deepEqual(resolveRule(path), { window: 60, max: 5 }, path);
  }
  assert.deepEqual(resolveRule("/passkey/generate-authenticate-options"), { window: 60, max: 20 });
  assert.deepEqual(resolveRule("/passkey/verify-authentication"), { window: 60, max: 10 });
});

test("resolves the client IP like the rest of the app, most specific header first", () => {
  assert.deepEqual(authIpAddressOptions.ipAddressHeaders, [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ]);
});

// --- The OAuth endpoints, for everyone and for the AI platforms -----------------

/** Better Auth with the app's limits and OAuth plugins, counting in memory. */
const oauthLimitedAuth = async (trustedProxy: TrustedProxy | undefined) => {
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const { AUTH_DISABLED_PATHS, mcpOAuthEndpoints, mcpOAuthPlugins } = await import("./oauth");
  const { authTables } = await import("./tables");
  const origin = "https://app.example.com";
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const model of Object.keys(authTables)) data[model] = [];
  return betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    secret: "rate-limit-test-secret-never-used-in-production-123456",
    trustedOrigins: [origin],
    database: memoryAdapter(data),
    // Better Auth's memory counters, with the app's rules.
    rateLimit: { ...authRateLimitOptionsBehind(trustedProxy), storage: "memory" },
    advanced: { ipAddress: authIpAddressOptions },
    logger: { disabled: true },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: mcpOAuthPlugins(mcpOAuthEndpoints(origin)!, {
      currentGrantId: async () => null,
      isGrantActive: async () => false,
    }),
  });
};

type Auth = Awaited<ReturnType<typeof oauthLimitedAuth>>;

const TOKEN = "/api/auth/oauth2/token";
const REGISTER = "/api/auth/oauth2/register";
const DISCOVERY = "/.well-known/oauth-protected-resource/api/mcp";

/** How many of `count` requests pass before the first 429 (count when none). */
const passed = async (auth: Auth, path: string, headers: Record<string, string>, count: number) => {
  for (let index = 0; index < count; index += 1) {
    const init: RequestInit =
      path === DISCOVERY
        ? { headers }
        : path === REGISTER
          ? {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify({
                redirect_uris: ["https://client.example.org/callback"],
                token_endpoint_auth_method: "none",
              }),
            }
          : {
              method: "POST",
              headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
              body: "grant_type=refresh_token&client_id=unknown&refresh_token=unknown",
            };
    const response = await auth.handler(new Request(`https://app.example.com${path}`, init));
    if (response.status === 429) return index;
  }
  return count;
};

test("TRUSTED_PROXY is cloudflare or unset; an empty value is unset", () => {
  assert.equal(trustedProxySchema.parse("cloudflare"), "cloudflare");
  assert.equal(trustedProxySchema.parse(""), undefined);
  assert.equal(trustedProxySchema.parse(undefined), undefined);
  for (const value of ["traefik", "Cloudflare", "true"]) {
    assert.equal(trustedProxySchema.safeParse(value).success, false, value);
  }
});

test("an ordinary address keeps the OAuth endpoints' usual limits", async () => {
  const auth = await oauthLimitedAuth("cloudflare");
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "203.0.113.1" }, 30), 20);
  assert.equal(await passed(auth, REGISTER, { "cf-connecting-ip": "203.0.113.2" }, 10), 5);
  assert.equal(await passed(auth, DISCOVERY, { "cf-connecting-ip": "203.0.113.3" }, 110), 100);
});

test("behind Cloudflare, a platform address in cf-connecting-ip gets the platform ceiling", async () => {
  const auth = await oauthLimitedAuth("cloudflare");
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "160.79.104.10" }, 610), 600);
  // The counter is Better Auth's, per address: the next one of the range starts afresh.
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "160.79.104.11" }, 30), 30);
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "153.61.208.20" }, 30), 30);
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "9.129.3.4" }, 30), 30);
  assert.equal(await passed(auth, REGISTER, { "cf-connecting-ip": "52.6.94.121" }, 70), 60);
  assert.equal(await passed(auth, DISCOVERY, { "cf-connecting-ip": "160.79.104.12" }, 610), 600);
});

/**
 * Headers a visitor can send to claim a platform address, without Cloudflare's
 * own. Each test claims its own addresses: Better Auth's memory counters are
 * shared by every instance of the process.
 */
const spoofed = (from: number): Record<string, string>[] => [
  { "true-client-ip": `160.79.105.${from}` },
  { "x-real-ip": `160.79.105.${from + 1}` },
  { "x-forwarded-for": `160.79.105.${from + 2}` },
];

/**
 * A forwarded chain is never trusted: Better Auth counts it in one bucket
 * shared by every such request (127.0.0.1 in tests), so it gets at most the
 * usual 20, never the platform's 600.
 */
const chainStaysOrdinary = async (auth: Auth) => {
  const chain = { "x-forwarded-for": "160.79.105.99, 10.0.0.1" };
  assert.ok((await passed(auth, TOKEN, chain, 30)) <= 20, "a forwarded chain");
};

test("without TRUSTED_PROXY no header raises a ceiling, Cloudflare's included", async () => {
  const auth = await oauthLimitedAuth(undefined);
  assert.equal(await passed(auth, TOKEN, { "cf-connecting-ip": "160.79.104.70" }, 30), 20);
  for (const headers of spoofed(10)) {
    assert.equal(await passed(auth, TOKEN, headers, 30), 20, JSON.stringify(headers));
  }
  await chainStaysOrdinary(auth);
  assert.equal(await passed(auth, REGISTER, { "true-client-ip": "160.79.104.75" }, 10), 5);
});

test("behind Cloudflare, only a valid cf-connecting-ip decides: the other headers never do", async () => {
  const auth = await oauthLimitedAuth("cloudflare");
  // No Cloudflare header at all.
  for (const headers of spoofed(20)) {
    assert.equal(await passed(auth, TOKEN, headers, 30), 20, JSON.stringify(headers));
  }
  await chainStaysOrdinary(auth);
  assert.equal(await passed(auth, REGISTER, { "true-client-ip": "160.79.104.76" }, 10), 5);
  // A malformed Cloudflare header, with a platform address claimed behind it
  // (Better Auth then counts under that address: one per case).
  const invalid = ["not-an-ip", "160.79.104", "160.79.104.77, 10.0.0.1", "160.79.104.256"];
  for (const [index, value] of invalid.entries()) {
    const headers = { "cf-connecting-ip": value, "true-client-ip": `160.79.106.${index}` };
    assert.equal(await passed(auth, TOKEN, headers, 30), 20, value);
  }
  // Cloudflare's address is ordinary: a platform address claimed in a later header is not read.
  const claimed = { "cf-connecting-ip": "203.0.113.4", "x-real-ip": "160.79.104.79" };
  assert.equal(await passed(auth, TOKEN, claimed, 30), 20);
});
