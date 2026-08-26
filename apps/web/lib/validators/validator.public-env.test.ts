import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePublicEnv, readPublicEnvRuntime } from "./validator.public-env";

test("parses runtime public values without exposing private variables", () => {
  const config = parsePublicEnv({
    AUTH_SECRET: "must-not-reach-the-browser",
    NEXT_PUBLIC_APP_DOMAIN: "runtime.example.com",
    NEXT_PUBLIC_APP_URL: "https://runtime.example.com",
    NEXT_PUBLIC_GLEAP_API_KEY: "runtime-gleap-key",
  });

  assert.equal(config.NEXT_PUBLIC_APP_URL, "https://runtime.example.com");
  assert.equal(config.NEXT_PUBLIC_APP_DOMAIN, "runtime.example.com");
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
