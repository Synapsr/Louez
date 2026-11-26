import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";

import { orpcClient, orpcClientForStore } from "./client";

// The app's oRPC client sends an idempotency key only on a call that passes
// one (`context.idempotencyKey`); every other call sends exactly the headers
// it sent before.

Object.assign(globalThis, { React });

const sent: Headers[] = [];
const originalFetch = globalThis.fetch;

before(() => {
  // The link reads the app's address from the public configuration.
  renderToStaticMarkup(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      {null}
    </PublicEnvProvider>,
  );
  globalThis.fetch = async (input: RequestInfo | URL) => {
    sent.push(new Headers((input as Request).headers));
    return new Response(JSON.stringify({ json: { ok: true } }), {
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  sent.length = 0;
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

const names = (headers: Headers | undefined) => [...(headers?.keys() ?? [])].sort();

test("a call without an idempotency key sends no such header, as before", async () => {
  await orpcClient.dashboard.partners.list({});
  await orpcClientForStore("store_a").dashboard.partners.markMonthPaid({
    partnerId: "partner_a",
    month: "2026-11",
  });

  assert.equal(sent.length, 2);
  for (const headers of sent) assert.equal(headers.get("idempotency-key"), null);
  // The store client still names its store, and nothing else changed.
  assert.equal(sent[1]?.get("louez-store"), "store_a");
  assert.deepEqual(names(sent[1]), [...names(sent[0]), "louez-store"].sort());
});

test("a call with a key sends it, and only that call", async () => {
  await orpcClient.dashboard.partners.markMonthPaid(
    { partnerId: "partner_a", month: "2026-11" },
    { context: { idempotencyKey: "pay-nov-1" } },
  );
  await orpcClient.dashboard.partners.markMonthPaid({ partnerId: "partner_a", month: "2026-11" });

  assert.equal(sent[0]?.get("idempotency-key"), "pay-nov-1");
  assert.equal(sent[1]?.get("idempotency-key"), null);
  assert.deepEqual(names(sent[0]), [...names(sent[1]), "idempotency-key"].sort());
});
