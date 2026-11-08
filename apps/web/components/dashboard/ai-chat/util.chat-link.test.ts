import assert from "node:assert/strict";
import test from "node:test";

import { resolveChatLink } from "./util.chat-link";

const platform = { appUrl: "https://app.louez.test", appDomain: "louez.test" };
const local = { appUrl: "http://localhost:3000", appDomain: "localhost:3000" };
const standalone = { appUrl: "https://location.example.test", appDomain: "location.example.test" };

test("a dashboard link on the app's origin opens in the app, as a relative path", () => {
  assert.deepEqual(resolveChatLink("https://app.louez.test/dashboard/products/p1", platform), {
    kind: "app",
    href: "/dashboard/products/p1",
  });
  assert.deepEqual(
    resolveChatLink("https://app.louez.test/dashboard/reservations/r1?tab=payments", platform),
    { kind: "app", href: "/dashboard/reservations/r1?tab=payments" },
  );
  // The former relative form the assistant wrote itself.
  assert.deepEqual(resolveChatLink("/dashboard/customers/c1", platform), {
    kind: "app",
    href: "/dashboard/customers/c1",
  });
  // A link naming its store keeps it: the app switches, then drops it.
  assert.deepEqual(
    resolveChatLink("https://app.louez.test/dashboard/products/p1?store=s1", platform),
    {
      kind: "app",
      href: "/dashboard/products/p1?store=s1",
    },
  );
  assert.deepEqual(resolveChatLink("http://localhost:3000/dashboard", local), {
    kind: "app",
    href: "/dashboard",
  });
});

test("a storefront link opens in a new tab: store subdomain, local path routing, standalone", () => {
  assert.deepEqual(resolveChatLink("https://ddm.louez.test/product/kayak", platform), {
    kind: "external",
    href: "https://ddm.louez.test/product/kayak",
  });
  assert.deepEqual(resolveChatLink("http://localhost:3000/ddm/product/kayak", local), {
    kind: "external",
    href: "http://localhost:3000/ddm/product/kayak",
  });
  assert.deepEqual(resolveChatLink("https://location.example.test/product/kayak", standalone), {
    kind: "external",
    href: "https://location.example.test/product/kayak",
  });
});

test("anything else stays plain text", () => {
  for (const href of [
    "https://evil.test/dashboard/products/p1",
    "https://louez.test.evil.test/product/kayak",
    "//evil.test/dashboard",
    "javascript:alert(1)",
    "mailto:someone@louez.test",
    "https://user:pass@app.louez.test/dashboard",
    "https://app.louez.test/api/auth/sign-out",
    "/ddm/product/kayak",
    "products/p1",
    "not a url",
  ]) {
    assert.equal(resolveChatLink(href, platform), null, href);
  }
});

test("a dashboard path on another origin is not taken for an in-app one", () => {
  assert.equal(resolveChatLink("https://other.test/dashboard", platform), null);
  // A store subdomain's /dashboard is a storefront page, opened in a new tab.
  assert.deepEqual(resolveChatLink("https://ddm.louez.test/dashboard", platform), {
    kind: "external",
    href: "https://ddm.louez.test/dashboard",
  });
});
