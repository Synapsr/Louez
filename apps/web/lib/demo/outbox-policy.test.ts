import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApiEffectSenders, EffectSendContext } from "@louez/api/platform/effects";

import { withDemoStorePolicy } from "./outbox-policy";

// No outbox row of a demo store is ever sent: its e-mails, SMS, Stripe calls and
// notices are skipped, whatever wrote them; every other store's rows go as before.

const context = (storeId: string) =>
  ({
    effectId: `effect_${storeId}`,
    row: { storeId, reservationId: null, customerId: null },
    signal: new AbortController().signal,
  }) as EffectSendContext;

test("a demo store's rows are skipped, the others are sent", async () => {
  const sent: string[] = [];
  const senders = new Proxy(
    {},
    {
      get: (_target, type: string) => async (_payload: unknown, ctx: EffectSendContext) => {
        sent.push(`${type}:${ctx.row.storeId}`);
        return undefined;
      },
      ownKeys: () => ["reservation.confirmationEmail", "sms.send"],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  ) as ApiEffectSenders;

  const wrapped = withDemoStorePolicy(senders, async (storeId) => storeId === "demo");
  const email = wrapped["reservation.confirmationEmail" as keyof ApiEffectSenders] as unknown as (
    payload: unknown,
    ctx: EffectSendContext,
  ) => Promise<unknown>;

  assert.deepEqual(await email({}, context("demo")), { skipped: "demo store" });
  assert.equal(await email({}, context("real")), undefined);
  assert.deepEqual(sent, ["reservation.confirmationEmail:real"]);
});
