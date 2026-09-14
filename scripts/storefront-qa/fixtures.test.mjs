import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFixtureServer } from "./fixtures.mjs";
import { appEnv } from "./runtime.mjs";

test("application environment does not inherit provider or database credentials", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "mysql://do-not-inherit";
  try {
    const configured = appEnv({
      dbPort: 12345,
      dbPassword: "qa-password",
      fixturePort: 12346,
      encryptionKey: "a".repeat(64),
    });
    assert.equal(
      configured.DATABASE_URL,
      "mysql://storefront_qa:qa-password@127.0.0.1:12345/louez_storefront_qa",
    );
    assert.equal(configured.STRIPE_SECRET_KEY, "sk_test_local_qa_simulation");
    assert.equal(configured.SMS_PARTNER_API_KEY, undefined);
    assert.equal(configured.AI_API_KEY, undefined);
    assert.equal(configured.NEXT_PUBLIC_POSTHOG_KEY, undefined);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("fixture transport preserves amounts and payment state, rejects unsupported operations", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "louez-qa-fixtures-"));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ tulipProducts: [] }));
  const state = { fixturePort: 0 };
  const server = createFixtureServer(state, dir);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  state.fixturePort = address.port;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const form = new URLSearchParams({
      "line_items[0][quantity]": "2",
      "line_items[0][price_data][unit_amount]": "2500",
      "line_items[0][price_data][currency]": "eur",
      "metadata[reservationId]": "qa-reservation",
      success_url:
        "https://paiement.louez-qa.localify/checkout/return?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://paiement.louez-qa.localify/checkout/cancelled",
    });
    const session = await (
      await fetch(`${base}/v1/checkout/sessions`, { method: "POST", body: form })
    ).json();
    assert.equal(session.amount_total, 5000);
    assert.equal(session.metadata.reservationId, "qa-reservation");
    assert.equal(session.payment_status, "unpaid");
    const action = (value) =>
      fetch(`${base}/checkout/${session.id}`, {
        method: "POST",
        body: new URLSearchParams({ action: value }),
        redirect: "manual",
      });
    const unpaid = await action("unpaid");
    assert.equal(unpaid.status, 303);
    assert.equal(
      (await (await fetch(`${base}/v1/checkout/sessions/${session.id}`)).json()).payment_status,
      "unpaid",
    );
    await action("success");
    assert.equal(
      (await (await fetch(`${base}/v1/checkout/sessions/${session.id}`)).json()).payment_status,
      "paid",
    );
    assert.equal((await fetch(`${base}/v1/refunds`, { method: "POST" })).status, 501);
    assert.equal(
      (
        await fetch(`${base}/mode`, {
          method: "POST",
          headers: { Origin: "https://outside.example" },
          body: "mode=error",
        })
      ).status,
      403,
    );
    await fetch(`${base}/mode`, { method: "POST", body: "mode=error", redirect: "manual" });
    assert.equal((await fetch(`${base}/tulip/products`)).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
