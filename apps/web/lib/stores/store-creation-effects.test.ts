import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { StoreCreationEffectDeps } from "./store-creation-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The senders' modules import "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

// The senders of a new store's outbox rows, with fakes that note each call:
// the welcome credits the row froze, and analytics events that keep their id
// and time from one try to the next.

describe("store creation effect senders", () => {
  let calls: Array<[string, unknown]> = [];
  let granted = new Set<string>();
  let failCapture = false;

  const context: EffectSendContext = {
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {},
  };

  const deps: StoreCreationEffectDeps = {
    creditAiCredits: async (params) => {
      calls.push(["creditAiCredits", params]);
      if (params.dedupKey) granted.add(params.dedupKey);
      return true;
    },
    hasCreditGrant: async (dedupKey) => granted.has(dedupKey),
    captureProductServerEventOrThrow: async (event) => {
      calls.push(["captureProductServerEventOrThrow", event]);
      if (failCapture) throw new Error("PostHog answered 503.");
      return undefined;
    },
    captureServerEventOrThrow: async (event) => {
      calls.push(["captureServerEventOrThrow", event]);
      if (failCapture) throw new Error("PostHog answered 503.");
      return undefined;
    },
  };

  let create: typeof import("./store-creation-effects").createStoreCreationEffectSenders;
  let senders: ReturnType<typeof create>;

  before(async () => {
    ({ createStoreCreationEffectSenders: create } = await import("./store-creation-effects"));
    senders = create(deps);
  });

  beforeEach(() => {
    calls = [];
    granted = new Set();
    failCapture = false;
  });

  test("the welcome credits are the row's, whatever the setting says when it goes out", async () => {
    await senders["store.welcomeCredits"]({ storeId: "store_1", credits: 7 }, context);
    assert.deepEqual(calls, [
      [
        "creditAiCredits",
        { storeId: "store_1", credits: 7, type: "grant", dedupKey: "grant:store_1" },
      ],
    ]);
  });

  test("welcome credits that were not written fail the row, so it is retried", async () => {
    const lost = create({ ...deps, hasCreditGrant: async () => false });
    await assert.rejects(
      lost["store.welcomeCredits"]({ storeId: "store_1", credits: 7 }, context),
      /not granted/,
    );
  });

  test("a retried analytics row sends the same event id and time", async () => {
    const payload = {
      eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
      occurredAt: "2026-11-08T10:00:00.000Z",
      event: "referral_attribution_resolved" as const,
      ownerUserId: "owner",
      transport: "mcp" as const,
      properties: { referred_store_id: "store_1" },
    };
    failCapture = true;
    await assert.rejects(senders["store.creationAnalytics"](payload, context));
    failCapture = false;
    await senders["store.creationAnalytics"](payload, context);

    const identity = { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt };
    const sent = calls.map(([, event]) => event as { event: string; identity: unknown });
    assert.equal(sent.length, 2);
    for (const event of sent) {
      assert.equal(event.event, "referral_store_attribution_resolved");
      assert.deepEqual(event.identity, identity);
    }

    await senders["store.creationAnalytics"]({ ...payload, event: "store_info_saved" }, context);
    const [, saved] = calls[2] as [
      string,
      { identity: unknown; properties: Record<string, unknown> },
    ];
    assert.equal(calls[2]?.[0], "captureProductServerEventOrThrow");
    assert.deepEqual(saved.identity, identity);
    assert.equal(saved.properties.surface, "mcp");
  });
});
