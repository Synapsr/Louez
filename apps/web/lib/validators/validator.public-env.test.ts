import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePublicEnv, readPublicEnvRuntime } from "./validator.public-env";

test("parses runtime public values without exposing private variables", () => {
  const config = parsePublicEnv({
    AUTH_SECRET: "must-not-reach-the-browser",
    NEXT_PUBLIC_APP_DOMAIN: "runtime.example.com",
    NEXT_PUBLIC_APP_URL: "https://runtime.example.com",
    NEXT_PUBLIC_FORMAT_LOCALE: "de-AT",
    NEXT_PUBLIC_GLEAP_API_KEY: "runtime-gleap-key",
  });

  assert.equal(config.NEXT_PUBLIC_APP_URL, "https://runtime.example.com");
  assert.equal(config.NEXT_PUBLIC_APP_DOMAIN, "runtime.example.com");
  assert.equal(config.NEXT_PUBLIC_FORMAT_LOCALE, "de-AT");
  assert.equal(config.NEXT_PUBLIC_GLEAP_API_KEY, "runtime-gleap-key");
  assert.equal("AUTH_SECRET" in config, false);
});

test("derives the public origin from AUTH_URL for zero-config containers", () => {
  const config = parsePublicEnv({
    AUTH_URL: "https://standalone.example.com",
  });

  assert.equal(config.NEXT_PUBLIC_APP_URL, "https://standalone.example.com");
  assert.equal(config.NEXT_PUBLIC_APP_DOMAIN, "standalone.example.com");
  assert.equal(config.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN, "app");
});

test("reads and validates public values through a computed runtime lookup", () => {
  const runtime: Record<string, string | undefined> = {
    AUTH_URL: "https://reader.example.com",
    NEXT_PUBLIC_GLEAP_API_KEY: "runtime-reader-key",
  };
  const config = readPublicEnvRuntime({
    readEnv: (name) => runtime[name],
  });

  assert.equal(config.NEXT_PUBLIC_APP_URL, "https://reader.example.com");
  assert.equal(config.NEXT_PUBLIC_APP_DOMAIN, "reader.example.com");
  assert.equal(config.NEXT_PUBLIC_GLEAP_API_KEY, "runtime-reader-key");
});

test("treats empty optional values as unset, as the bundled Compose file passes them", () => {
  const runtime: Record<string, string | undefined> = {
    AUTH_URL: "https://compose.example.com",
    NEXT_PUBLIC_APP_URL: "https://compose.example.com",
    NEXT_PUBLIC_APP_DOMAIN: "compose.example.com",
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN: "",
    NEXT_PUBLIC_FORMAT_LOCALE: "",
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: "",
    NEXT_PUBLIC_OPENREPLAY_INGEST_POINT: "",
    NEXT_PUBLIC_FROMHELLO_API_URL: " ",
    NEXT_PUBLIC_META_PIXEL_ID: "",
    NEXT_PUBLIC_POSTHOG_HOST: "",
  };
  const config = readPublicEnvRuntime({
    readEnv: (name) => runtime[name],
  });

  assert.equal(config.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN, "app");
  assert.equal(config.NEXT_PUBLIC_FORMAT_LOCALE, undefined);
  assert.equal(config.NEXT_PUBLIC_UMAMI_SCRIPT_URL, undefined);
  assert.equal(config.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT, undefined);
  assert.equal(config.NEXT_PUBLIC_FROMHELLO_API_URL, undefined);
  assert.equal(config.NEXT_PUBLIC_META_PIXEL_ID, undefined);
  assert.equal(config.NEXT_PUBLIC_POSTHOG_HOST, "https://eu.i.posthog.com");
});

test("accepts a numeric Meta pixel ID and rejects anything else", () => {
  const base = { NEXT_PUBLIC_APP_URL: "https://app.example.com" };

  assert.equal(
    parsePublicEnv({ ...base, NEXT_PUBLIC_META_PIXEL_ID: "123456" }).NEXT_PUBLIC_META_PIXEL_ID,
    "123456",
  );
  assert.throws(() => parsePublicEnv({ ...base, NEXT_PUBLIC_META_PIXEL_ID: "not-a-pixel" }));
});

test("falls back to AUTH_URL when the public origin is passed empty", () => {
  const config = parsePublicEnv({
    AUTH_URL: "https://fallback.example.com",
    NEXT_PUBLIC_APP_URL: "",
    NEXT_PUBLIC_APP_DOMAIN: "",
  });

  assert.equal(config.NEXT_PUBLIC_APP_URL, "https://fallback.example.com");
  assert.equal(config.NEXT_PUBLIC_APP_DOMAIN, "fallback.example.com");
});
