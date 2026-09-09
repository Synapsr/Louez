import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontUrl,
  isLocalAppDomain,
  toStorefrontPathSuffix,
} from "./util.storefront-url";

// One scenario per caller and per host: the inputs mirror exactly what
// storefront-url.ts, use-storefront-url.ts and seo.tsx derive from their
// environment, and the expectations pin the historical output byte for byte.

const platform = {
  standalone: false,
  appDomain: "louez.io",
  origin: "https://app.louez.io",
  protocol: "https",
} as const;

test("toStorefrontPathSuffix normalises the leading slash and drops the root", () => {
  assert.equal(toStorefrontPathSuffix("/"), "");
  assert.equal(toStorefrontPathSuffix(""), "");
  assert.equal(toStorefrontPathSuffix("/catalog"), "/catalog");
  assert.equal(toStorefrontPathSuffix("catalog"), "/catalog");
  assert.equal(toStorefrontPathSuffix("/?channel=marketplace"), "/?channel=marketplace");
});

test("isLocalAppDomain treats missing and loopback domains as local", () => {
  assert.equal(isLocalAppDomain(undefined), true);
  assert.equal(isLocalAppDomain(""), true);
  assert.equal(isLocalAppDomain("localhost:3000"), true);
  assert.equal(isLocalAppDomain("127.0.0.1:3015"), true);
  assert.equal(isLocalAppDomain("ddm.localhost"), true);
  assert.equal(isLocalAppDomain("louez.io"), false);
  assert.equal(isLocalAppDomain("feat.louez.localify"), false);
});

test("subdomain host: the store lives on {slug}.{appDomain}", () => {
  assert.equal(buildStorefrontUrl({ ...platform, slug: "ddm" }), "https://ddm.louez.io");
  assert.equal(buildStorefrontUrl({ ...platform, slug: "ddm", path: "/" }), "https://ddm.louez.io");
  assert.equal(
    buildStorefrontUrl({ ...platform, slug: "ddm", path: "/account" }),
    "https://ddm.louez.io/account",
  );
  assert.equal(
    buildStorefrontUrl({ ...platform, slug: "ddm", path: "account/login" }),
    "https://ddm.louez.io/account/login",
  );
  // Server redirects use the protocol of NEXT_PUBLIC_APP_URL.
  assert.equal(
    buildStorefrontUrl({ ...platform, protocol: "http", slug: "ddm", path: "/embed" }),
    "http://ddm.louez.io/embed",
  );
});

test("subdomain host: embed and marketplace entry points keep their query strings", () => {
  assert.equal(
    buildStorefrontUrl({ ...platform, slug: "ddm", path: "/embed" }),
    "https://ddm.louez.io/embed",
  );
  assert.equal(
    buildStorefrontUrl({ ...platform, slug: "ddm", path: "/?channel=marketplace" }),
    "https://ddm.louez.io/?channel=marketplace",
  );
  assert.equal(
    buildStorefrontUrl({
      ...platform,
      slug: "ddm",
      path: "/rental?startDate=2026-09-10&endDate=2026-09-12",
    }),
    "https://ddm.louez.io/rental?startDate=2026-09-10&endDate=2026-09-12",
  );
});

test("dashboard host: the origin never leaks into a platform store URL", () => {
  assert.equal(
    buildStorefrontUrl({
      ...platform,
      origin: "https://app.louez.io",
      slug: "ddm",
      path: "/catalog",
    }),
    "https://ddm.louez.io/catalog",
  );
  assert.equal(
    buildStorefrontUrl({ ...platform, origin: "", slug: "ddm", path: "/catalog" }),
    "https://ddm.louez.io/catalog",
  );
});

test("localhost: platform development falls back to {origin}/{slug} path routing", () => {
  const local = {
    standalone: false,
    appDomain: "localhost:3000",
    origin: "http://localhost:3000",
    protocol: "http",
  } as const;
  assert.equal(buildStorefrontUrl({ ...local, slug: "ddm" }), "http://localhost:3000/ddm");
  assert.equal(
    buildStorefrontUrl({ ...local, slug: "ddm", path: "/account" }),
    "http://localhost:3000/ddm/account",
  );
  assert.equal(
    buildStorefrontUrl({ ...local, slug: "ddm", path: "/embed" }),
    "http://localhost:3000/ddm/embed",
  );
  assert.equal(
    buildStorefrontUrl({ ...local, slug: "ddm", path: "/?channel=marketplace" }),
    "http://localhost:3000/ddm/?channel=marketplace",
  );
  assert.equal(
    buildStorefrontUrl({
      ...local,
      appDomain: "127.0.0.1:3015",
      origin: "http://127.0.0.1:3015",
      slug: "armor-location",
    }),
    "http://127.0.0.1:3015/armor-location",
  );
  // The client hook may run before NEXT_PUBLIC_APP_DOMAIN is known.
  assert.equal(
    buildStorefrontUrl({ ...local, appDomain: undefined, slug: "ddm", path: "/catalog" }),
    "http://localhost:3000/ddm/catalog",
  );
});

test("standalone: the storefront is the origin root, never slugged", () => {
  const standalone = {
    standalone: true,
    appDomain: "louez.io",
    origin: "https://location.example.com",
    protocol: "https",
  } as const;
  assert.equal(buildStorefrontUrl({ ...standalone, slug: "ddm" }), "https://location.example.com");
  assert.equal(
    buildStorefrontUrl({ ...standalone, slug: "ddm", path: "/" }),
    "https://location.example.com",
  );
  assert.equal(
    buildStorefrontUrl({ ...standalone, slug: "ddm", path: "/checkout" }),
    "https://location.example.com/checkout",
  );
  assert.equal(
    buildStorefrontUrl({ ...standalone, slug: "ddm", path: "embed" }),
    "https://location.example.com/embed",
  );
  assert.equal(
    buildStorefrontUrl({ ...standalone, slug: "ddm", path: "/?channel=marketplace" }),
    "https://location.example.com/?channel=marketplace",
  );
  // Before hydration the client has no origin yet: stay site-relative.
  assert.equal(buildStorefrontUrl({ ...standalone, origin: "", slug: "ddm" }), "/");
  assert.equal(
    buildStorefrontUrl({ ...standalone, origin: "", slug: "ddm", path: "/catalog" }),
    "/catalog",
  );
});

test("seo canonicals: same rule with the NODE_ENV protocol", () => {
  assert.equal(
    buildStorefrontUrl({ ...platform, protocol: "http", slug: "ddm" }),
    "http://ddm.louez.io",
  );
  assert.equal(
    buildStorefrontUrl({
      standalone: true,
      appDomain: "louez.io",
      origin: "https://app.louez.io",
      protocol: "https",
      slug: "ddm",
    }),
    "https://app.louez.io",
  );
});
