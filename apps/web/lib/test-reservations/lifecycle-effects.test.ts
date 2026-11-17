import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { TestReservationEffectDeps } from "./lifecycle-effects";

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

// A test reservation's outbox senders, with fakes: the analytics event goes
// out with its row's identity and store, and the files deleted are the row's
// own store's only.

describe("test reservation senders", () => {
  let senders: Awaited<
    ReturnType<typeof import("./lifecycle-effects").createTestReservationEffectSenders>
  >;
  const captured: Array<
    Parameters<TestReservationEffectDeps["captureProductServerEventOrThrow"]>[0]
  > = [];
  const deleted: string[] = [];
  let claims = 0;

  const context: EffectSendContext = {
    effectId: "effect_test",
    row: { storeId: "store_a", reservationId: null, customerId: null },
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };

  before(async () => {
    const { createTestReservationEffectSenders } = await import("./lifecycle-effects");
    senders = createTestReservationEffectSenders({
      captureProductServerEventOrThrow: async (event) => {
        captured.push(event);
        return undefined;
      },
      deleteFile: async (key) => {
        deleted.push(key);
      },
    });
  });

  test("sends the event with its identity, counted on the row's store", async () => {
    await senders["testReservation.analytics"](
      {
        eventUuid: "uuid-1",
        occurredAt: "2026-11-17T10:00:00.000Z",
        event: "test_reservation_deleted",
        distinctId: "user_1",
        storeId: "store_b",
        properties: { store_id: "store_b", trigger: "manual" },
      },
      context,
    );
    assert.equal(claims, 1);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.event, "test_reservation_deleted");
    assert.equal(captured[0]?.distinctId, "user_1");
    assert.deepEqual(captured[0]?.identity, {
      eventUuid: "uuid-1",
      occurredAt: "2026-11-17T10:00:00.000Z",
    });
    assert.equal(captured[0]?.properties?.store_id, "store_a");
    assert.equal(captured[0]?.properties?.trigger, "manual");
    assert.equal(captured[0]?.properties?.feature, "test_reservation");
  });

  test("deletes only the files of the row's own store", async () => {
    await senders["testReservation.deleteFiles"](
      { keys: ["store_a/inspections/one.jpg", "store_b/inspections/two.jpg", "store_a/x.jpg"] },
      context,
    );
    assert.deepEqual(deleted, ["store_a/inspections/one.jpg", "store_a/x.jpg"]);
  });
});
