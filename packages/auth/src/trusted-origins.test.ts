import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { authOriginOptions, trustedOriginCheck } from "./trusted-origins";

// The origins the auth layer trusts, as Better Auth itself decides them from
// the options the auth configuration hands it (`authOriginOptions`) and the
// origins an operator lists in BETTER_AUTH_TRUSTED_ORIGINS: the chat's
// same-origin check asks this very resolver (`trustedOriginCheck`), so the
// two cannot accept different sets.

const SECRET = "trusted-origins-test-secret-never-used-in-production-1234";

/** Better Auth with the app's origin options, in memory, BETTER_AUTH_TRUSTED_ORIGINS as given. */
async function resolverFor(
  config: { authUrl: string; development: boolean },
  listed: string | undefined,
) {
  if (listed === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  else process.env.BETTER_AUTH_TRUSTED_ORIGINS = listed;
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const instance = betterAuth({
    basePath: "/api/auth",
    secret: SECRET,
    database: memoryAdapter({}),
    logger: { disabled: true },
    ...authOriginOptions(config),
  });
  const check = trustedOriginCheck(instance);
  // Resolved while the variable is as given.
  await instance.$context;
  return check;
}

describe("the origins the auth layer trusts", () => {
  test("production: the configured URL and the operator's listed aliases, nothing else", async () => {
    const trusts = await resolverFor(
      { authUrl: "https://app.example.org", development: false },
      "https://alias.example.org",
    );
    assert.equal(await trusts("https://app.example.org"), true);
    assert.equal(await trusts("https://alias.example.org"), true);
    for (const origin of [
      "https://shop.example.org",
      "https://alias.example.org.evil.test",
      "http://app.example.org",
      "https://louez.localify.fyi",
    ]) {
      assert.equal(await trusts(origin), false, origin);
    }
  });

  test("production without a listed alias trusts the configured URL alone", async () => {
    const trusts = await resolverFor(
      { authUrl: "https://app.example.org", development: false },
      undefined,
    );
    assert.equal(await trusts("https://app.example.org"), true);
    assert.equal(await trusts("https://alias.example.org"), false);
  });

  test("development: the project's Localify hosts too", async () => {
    const trusts = await resolverFor(
      { authUrl: "https://louez.localify", development: true },
      undefined,
    );
    for (const origin of [
      "https://louez.localify",
      "https://louez.localify.fyi",
      "https://feat-chat.louez.localify",
      "https://louez--feat-chat.localify.fyi",
    ]) {
      assert.equal(await trusts(origin), true, origin);
    }
    assert.equal(await trusts("https://other.localify.fyi"), false);
  });

  test("the auth configuration hands Better Auth these options, and the chat asks that instance", () => {
    // Read as written: the app's instance takes its origins from
    // `authOriginOptions` and from nowhere else, and the check the chat asks
    // is that instance's own resolver. A second list, anywhere in its
    // options, fails here.
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const authInstance = betterAuth({");
    assert.ok(start >= 0);
    const options = source.slice(start, source.indexOf("\n});\n", start));
    assert.match(
      source,
      /const authOrigins = authOriginOptions\(\{ authUrl: env\.AUTH_URL, development: isDevelopment \}\);/,
    );
    assert.match(options, /^\s+\.\.\.authOrigins,$/m);
    assert.doesNotMatch(options, /^\s+(baseURL|trustedOrigins)\s*:/m);
    assert.match(source, /export const isTrustedAuthOrigin = trustedOriginCheck\(authInstance\);/);
  });
});
