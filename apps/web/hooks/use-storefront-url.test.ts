import assert from "node:assert/strict";
import test from "node:test";

import { buildAbsoluteStorefrontUrl } from "./use-storefront-url";

// `getAbsoluteUrl` feeds copy buttons, preview links and share targets on the
// dashboard: the expectations below pin its output byte for byte.

test("keeps standalone URLs hydration-safe before the browser origin is available", () => {
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "localhost:3000",
      origin: "",
      standalone: true,
      storeSlug: "armor-location",
    }),
    "/",
  );

  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "localhost:3000",
      origin: "http://localhost:3000",
      path: "/catalog",
      standalone: true,
      storeSlug: "armor-location",
    }),
    "http://localhost:3000/catalog",
  );
});

test("standalone: the current origin is the store root, whatever the host", () => {
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "https://location.example.com",
      standalone: true,
      storeSlug: "armor-location",
    }),
    "https://location.example.com",
  );
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "https://location.example.com",
      path: "embed",
      standalone: true,
      storeSlug: "armor-location",
    }),
    "https://location.example.com/embed",
  );
});

test("uses the store subdomain for platform deployments", () => {
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "",
      path: "/catalog",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "https://armor-location.louez.io/catalog",
  );
  // The dashboard origin never leaks into the store URL.
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "https://app.louez.io",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "https://armor-location.louez.io",
  );
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "https://app.louez.io",
      path: "/embed",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "https://armor-location.louez.io/embed",
  );
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "louez.io",
      origin: "https://app.louez.io",
      path: "/?channel=marketplace",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "https://armor-location.louez.io/?channel=marketplace",
  );
});

test("uses path routing for local platform development", () => {
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "127.0.0.1:3015",
      origin: "http://127.0.0.1:3015",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "http://127.0.0.1:3015/armor-location",
  );
  assert.equal(
    buildAbsoluteStorefrontUrl({
      domain: "localhost:3000",
      origin: "http://localhost:3000",
      path: "/catalog",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "http://localhost:3000/armor-location/catalog",
  );
  // No configured domain behaves like local development.
  assert.equal(
    buildAbsoluteStorefrontUrl({
      origin: "http://localhost:3000",
      path: "/embed",
      standalone: false,
      storeSlug: "armor-location",
    }),
    "http://localhost:3000/armor-location/embed",
  );
});
