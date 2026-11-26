import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React, { isValidElement, type ReactNode } from "react";

import type { StorefrontStore } from "@/lib/storefront/get-store-by-slug";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The storefront's providers: inside the widget's iframe (`bare`), no session
// recording, no page views and no store statistics; a store's page has all three.

/** Every component of a tree, without rendering them. */
const componentsIn = (node: ReactNode): unknown[] => {
  if (Array.isArray(node)) return node.flatMap(componentsIn);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...componentsIn(node.props.children)];
};

const STORE = {
  id: "store_1",
  slug: "velo-brest",
  name: "Vélo Brest",
  settings: {},
  theme: null,
  aiAdvisorSettings: null,
  demoVertical: null,
} as unknown as StorefrontStore;

describe("storefront providers", async () => {
  const { StorefrontProviders } = await import("./storefront-providers");
  const { OpenReplayProvider } = await import("@/components/openreplay-provider");
  const { PostHogProvider } = await import("@/components/posthog-provider");
  const { AnalyticsProvider } = await import("@/contexts/analytics-context");

  const providersOf = (variant: "store" | "bare") =>
    componentsIn(
      StorefrontProviders({
        store: STORE,
        variant,
        basePath: "",
        messages: {},
        advisorEnabled: false,
        children: null,
      }),
    );

  test("a store's page records sessions, page views and store statistics", () => {
    const providers = providersOf("store");
    for (const provider of [OpenReplayProvider, PostHogProvider, AnalyticsProvider]) {
      assert.ok(providers.includes(provider));
    }
  });

  test("the widget's iframe has none of them", () => {
    const providers = providersOf("bare");
    for (const provider of [OpenReplayProvider, PostHogProvider, AnalyticsProvider]) {
      assert.equal(providers.includes(provider), false);
    }
  });
});
