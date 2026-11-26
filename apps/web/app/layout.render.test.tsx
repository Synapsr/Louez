import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import React, { isValidElement, type ReactNode } from "react";

import { EMBED_MODE_HEADER } from "@/lib/embed/util.embed-request";
import { HANDOFF_ROUTE_HEADER } from "@/lib/handoffs/handoff-privacy";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The root layout of a request, as the proxy marks it: the storefront widget
// (`/[slug]/embed`, framed by the store's own website) loads no marketing
// tracker, a storefront page keeps them, and both keep PostHog.

// The public configuration the layout hands to the browser requires these.
process.env.NEXT_PUBLIC_APP_URL = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_DOMAIN = "louez.test";
process.env.NEXT_PUBLIC_FROMHELLO_KEY = "fh_test";
process.env.NEXT_PUBLIC_FROMHELLO_API_URL = "https://engagement.louez.test/";

let requestHeaders = new Headers();
let inDemoStore = false;

mock.module("next/headers", {
  namedExports: {
    headers: async () => requestHeaders,
    cookies: async () => ({ has: () => false }),
  },
});
mock.module("next/server", { namedExports: { connection: async () => {} } });
mock.module("next-intl/server", { namedExports: { getLocale: async () => "fr" } });
mock.module("@/lib/demo/demo-request", {
  namedExports: { isDemoRequest: async () => inDemoStore },
});
mock.module("./globals.css", { defaultExport: {} });

afterEach(() => {
  requestHeaders = new Headers();
  inDemoStore = false;
});

type Props = { children?: ReactNode } & Record<string, unknown>;

/** Every element of a tree, without rendering its components. */
const elementsIn = (node: ReactNode): React.ReactElement<Props>[] => {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elementsIn(node.props.children)];
};

const componentsIn = (node: ReactNode): unknown[] => elementsIn(node).map(({ type }) => type);

const layoutFor = async (headers: Record<string, string>) => {
  requestHeaders = new Headers(headers);
  const { default: RootLayout } = await import("./layout");
  return componentsIn(await RootLayout({ children: null }));
};

// What the proxy sets on a store's page (createStorefrontRewrite).
const STOREFRONT = { "x-store-slug": "velo-brest", "x-storefront-path": "/catalog" };
const EMBED = { ...STOREFRONT, "x-storefront-path": "/embed", [EMBED_MODE_HEADER]: "1" };

describe("root layout trackers", async () => {
  const { MarketingTrackers } = await import("@/components/marketing-trackers");
  const { PostHogBootstrap } = await import("@/components/shared/posthog-bootstrap");
  const { EvlogProvider } = await import("@/components/evlog-provider");
  const { UmamiAnalytics } = await import("@/components/umami-analytics");
  const { default: Script } = await import("next/script");

  test("the marketing trackers are Umami and fromHello's script, fetched with CORS", () => {
    const elements = elementsIn(MarketingTrackers());
    assert.ok(elements.some(({ type }) => type === UmamiAnalytics));
    const fromHello = elements.find(({ type }) => type === Script);
    assert.equal(fromHello?.props.src, "https://engagement.louez.test/api/t.js");
    assert.equal(fromHello?.props.crossOrigin, "anonymous");
  });

  test("a storefront page loads the marketing trackers and PostHog", async () => {
    const tree = await layoutFor(STOREFRONT);
    assert.ok(tree.includes(MarketingTrackers));
    assert.ok(tree.includes(PostHogBootstrap));
    assert.ok(tree.includes(EvlogProvider));
  });

  test("the storefront widget loads PostHog and no marketing tracker", async () => {
    const tree = await layoutFor(EMBED);
    assert.equal(tree.includes(MarketingTrackers), false);
    assert.ok(tree.includes(PostHogBootstrap));
    assert.ok(tree.includes(EvlogProvider));
  });

  test("a handoff page and a demo store load neither", async () => {
    const handoff = await layoutFor({ [HANDOFF_ROUTE_HEADER]: "1" });
    inDemoStore = true;
    const demoStore = await layoutFor(STOREFRONT);
    for (const tree of [handoff, demoStore]) {
      assert.equal(tree.includes(MarketingTrackers), false);
      assert.equal(tree.includes(PostHogBootstrap), false);
    }
  });
});
