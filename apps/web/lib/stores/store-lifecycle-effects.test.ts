import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { StoreLifecycleEffectDeps } from "./store-lifecycle-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The sender's modules import "server-only", which throws outside Next.
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

// The sender of a store's lifecycle rows: one event on the owner, with the
// row's own store, the same id and time on every try.

describe("store lifecycle effect sender", () => {
  let calls: unknown[] = [];
  let claims = 0;
  let failCapture = false;

  const context: EffectSendContext = {
    effectId: "effect_test",
    row: { storeId: "store_row", reservationId: null, customerId: null },
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };

  const deps: StoreLifecycleEffectDeps = {
    captureProductServerEventOrThrow: async (event) => {
      calls.push(event);
      if (failCapture) throw new Error("PostHog answered 503.");
      return undefined;
    },
  };

  let senders: ReturnType<
    typeof import("./store-lifecycle-effects").createStoreLifecycleEffectSenders
  >;

  before(async () => {
    const { createStoreLifecycleEffectSenders } = await import("./store-lifecycle-effects");
    senders = createStoreLifecycleEffectSenders(deps);
  });

  beforeEach(() => {
    calls = [];
    claims = 0;
    failCapture = false;
  });

  test("stripe_connect_completed on the owner, for the row's store, the same id on a retry", async () => {
    const payload = {
      eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
      occurredAt: "2026-11-17T10:00:00.000Z",
      event: "stripe_connect_completed" as const,
      ownerUserId: "owner",
      properties: {
        details_submitted: true,
        seconds_since_store_created: 3600,
        store_id: "forged",
      },
    };
    failCapture = true;
    await assert.rejects(senders["store.lifecycleAnalytics"](payload, context));
    failCapture = false;
    await senders["store.lifecycleAnalytics"](payload, context);

    assert.equal(claims, 2);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.deepEqual(call, {
        distinctId: "owner",
        event: "stripe_connect_completed",
        properties: {
          feature: "account_lifecycle",
          surface: "server",
          details_submitted: true,
          seconds_since_store_created: 3600,
          store_id: "store_row",
        },
        identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
      });
    }
  });
});
