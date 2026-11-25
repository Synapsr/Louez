import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it, mock, test } from "node:test";

import type { StripeConnectClient } from "./stripe-connect";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
mock.module("@louez/utils", { namedExports: require("@louez/utils") });

const { createDashboardUrl, getDashboardKind, paymentDashboardUrl, toProductDescription } =
  await import("./stripe-connect");

describe("toProductDescription", () => {
  it("drops the editor tags Stripe rejects", () => {
    assert.equal(
      toProductDescription(
        "<p>Location de <strong>sonorisation</strong> à Bourgoin.</p><p><strong>Téléphone</strong> : 06 07 19 75 57</p>",
      ),
      "Location de sonorisation à Bourgoin. Téléphone : 06 07 19 75 57",
    );
  });

  it("decodes ampersands but never rebuilds a tag", () => {
    assert.equal(
      toProductDescription("<p>Sono &amp; Lumière &lt;b&gt;</p>"),
      "Sono & Lumière &lt;b&gt;",
    );
  });

  it("caps the text at 500 characters", () => {
    assert.equal(toProductDescription(`<p>${"a".repeat(600)}</p>`)?.length, 500);
  });

  it("returns undefined when there is no visible text", () => {
    assert.equal(toProductDescription(null), undefined);
    assert.equal(toProductDescription("<p></p>"), undefined);
    assert.equal(toProductDescription("<p>&nbsp;</p>"), undefined);
  });
});

describe("the Stripe dashboard's link", () => {
  /** A connected account of `type`, recording what Louez asks of it. */
  const client = (type: string) => {
    const calls: string[] = [];
    const object =
      (kind: string) =>
      async (id: string, _params: undefined, options: { stripeAccount: string }) => {
        calls.push(`${kind}:${id}@${options.stripeAccount}`);
        return { id, livemode: !id.includes("test") };
      };
    const stripe: StripeConnectClient = {
      accounts: {
        create: async () => ({ id: "acct_new" }),
        retrieve: async () => ({ type }),
        createLoginLink: async (id) => {
          calls.push(`login:${id}`);
          return { url: `https://connect.stripe.test/express/${id}` };
        },
      },
      paymentIntents: { retrieve: object("payment_intent") },
      charges: { retrieve: object("charge") },
      accountLinks: { create: async () => ({ url: "https://connect.stripe.test/setup" }) },
    };
    return { stripe, calls };
  };

  test("a payment's page names its account, under test mode's path for a test payment", () => {
    assert.equal(
      paymentDashboardUrl({ accountId: "acct_1", id: "pi_1", livemode: true }),
      "https://dashboard.stripe.com/acct_1/payments/pi_1",
    );
    assert.equal(
      paymentDashboardUrl({ accountId: "acct_1", id: "ch_1", livemode: false }),
      "https://dashboard.stripe.com/acct_1/test/payments/ch_1",
    );
  });

  test("a Standard account opens on the payment, its mode as Stripe states it on the object read", async () => {
    const { stripe, calls } = client("standard");
    assert.equal(
      await createDashboardUrl(stripe, "acct_1", {
        paymentIntentId: "pi_live",
        chargeId: "ch_live",
      }),
      "https://dashboard.stripe.com/acct_1/payments/pi_live",
    );
    assert.equal(
      await createDashboardUrl(stripe, "acct_1", { paymentIntentId: null, chargeId: "ch_test" }),
      "https://dashboard.stripe.com/acct_1/test/payments/ch_test",
    );
    assert.equal(await createDashboardUrl(stripe, "acct_1"), "https://dashboard.stripe.com");
    assert.deepEqual(calls, ["payment_intent:pi_live@acct_1", "charge:ch_test@acct_1"]);
    assert.equal(await getDashboardKind(stripe, "acct_1"), "full");
  });

  test("an Express account gets its login link, whatever the payment, and nothing else is read", async () => {
    const { stripe, calls } = client("express");
    assert.equal(
      await createDashboardUrl(stripe, "acct_x", { paymentIntentId: "pi_live", chargeId: null }),
      "https://connect.stripe.test/express/acct_x",
    );
    assert.deepEqual(calls, ["login:acct_x"]);
    assert.equal(await getDashboardKind(stripe, "acct_x"), "express");
    assert.deepEqual(calls, ["login:acct_x"], "reading the kind makes no link");
  });
});
