import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { StoreLaunchEffectDeps } from "./store-launch-effects";

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

// The senders of a store's launch rows, with fakes that note each call: the
// platform's notice on its row's channel, checked against the claim first, and
// an analytics event that keeps its id and time from one try to the next.

describe("store launch effect senders", () => {
  let calls: Array<[string, unknown]> = [];
  let claims = 0;
  let failCapture = false;

  const context: EffectSendContext = {
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };

  const deps: StoreLaunchEffectDeps = {
    sendPlatformStoreLaunched: async (channel, store, beforeSend) => {
      await beforeSend();
      calls.push(["sendPlatformStoreLaunched", { channel, store }]);
      return undefined;
    },
    captureProductServerEventOrThrow: async (event) => {
      calls.push(["captureProductServerEventOrThrow", event]);
      if (failCapture) throw new Error("PostHog answered 503.");
      return undefined;
    },
  };

  let senders: ReturnType<typeof import("./store-launch-effects").createStoreLaunchEffectSenders>;

  before(async () => {
    const { createStoreLaunchEffectSenders } = await import("./store-launch-effects");
    senders = createStoreLaunchEffectSenders(deps);
  });

  beforeEach(() => {
    calls = [];
    claims = 0;
    failCapture = false;
  });

  test("the platform's notice goes out on its row's channel, after the claim check", async () => {
    const store = { id: "store_1", name: "Brest Surf", slug: "brest-surf" };
    await senders["store.launchNotification"]({ channel: "fromhello", store }, context);
    assert.deepEqual(calls, [["sendPlatformStoreLaunched", { channel: "fromhello", store }]]);
    assert.equal(claims, 1);
  });

  test("the onboarding's completion event: the dashboard's properties, the same id on a retry", async () => {
    const payload = {
      eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
      occurredAt: "2026-11-08T10:00:00.000Z",
      ownerUserId: "owner",
      storeId: "store_1",
      reservationMode: "request" as const,
      transport: "rpc" as const,
    };
    failCapture = true;
    await assert.rejects(senders["store.launchAnalytics"](payload, context));
    failCapture = false;
    await senders["store.launchAnalytics"](payload, context);

    const sent = calls.map(
      ([, event]) =>
        event as {
          distinctId: string;
          event: string;
          identity: unknown;
          properties: Record<string, unknown>;
        },
    );
    assert.equal(sent.length, 2);
    for (const event of sent) {
      assert.equal(event.event, "onboarding_completed");
      assert.equal(event.distinctId, "owner");
      assert.deepEqual(event.identity, {
        eventUuid: payload.eventUuid,
        occurredAt: payload.occurredAt,
      });
      assert.deepEqual(event.properties, {
        feature: "onboarding",
        surface: "dashboard",
        store_id: "store_1",
        reservation_mode: "request",
      });
    }

    calls = [];
    await senders["store.launchAnalytics"]({ ...payload, transport: "mcp" }, context);
    const [, agentEvent] = calls[0] as [string, { properties: Record<string, unknown> }];
    assert.equal(agentEvent.properties.surface, "mcp");
    assert.equal(agentEvent.properties.actor, "mcp");
  });
});
