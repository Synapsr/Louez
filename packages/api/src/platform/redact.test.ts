import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import type { StripeConnectClient } from "../adapters/stripe-connect";
import { createTestUrls } from "./test-urls";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
mock.module("@louez/utils", { namedExports: require("@louez/utils") });

const { redactHandoffSecrets } = await import("./redact");
const { describeProviderError } = await import("./sanitize-error");
const { startConnectOnboarding } = await import("../services/stripe-connect");

// A handoff's secrets never reach a log: the shared redactor, and a provider
// error that echoes the return URL, printed by the Stripe service.

const ID = "AbCdEfGhIjKlMnOpQrStU";
const SECRET = "s".repeat(43);
const STATE = "t".repeat(43);

/** What `run` writes to stdout and stderr, through the console or not. */
async function captureOutput(run: () => Promise<unknown>): Promise<string> {
  const written: string[] = [];
  const original = { out: process.stdout.write, err: process.stderr.write };
  const capture = (chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  process.stdout.write = capture;
  process.stderr.write = capture;
  try {
    await run().catch(() => undefined);
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
  return written.join("");
}

describe("handoff secrets in logs", () => {
  test("the redactor replaces the link's secret and the return's state, keeping the ids", () => {
    assert.equal(redactHandoffSecrets(`/handoffs/${ID}${SECRET}`), `/handoffs/${ID}[redacted]`);
    assert.equal(
      redactHandoffSecrets(`POST /handoffs/${ID}${SECRET}/continue failed`),
      `POST /handoffs/${ID}[redacted]/continue failed`,
    );
    assert.equal(
      redactHandoffSecrets(`https://app.louez.test/handoffs/return/${ID}/${STATE}?checkout=cs_1`),
      `https://app.louez.test/handoffs/return/${ID}/[redacted]?checkout=cs_1`,
    );
    assert.equal(
      redactHandoffSecrets(`/handoffs/refresh/${ID}/${STATE}`),
      `/handoffs/refresh/${ID}/[redacted]`,
    );
    assert.equal(
      redactHandoffSecrets(`return_url=https%3A%2F%2Fapp%2Fhandoffs%2Freturn%2F${ID}%2F${STATE}`),
      "return_url=https%3A%2F%2Fapp%2Fhandoffs%2F[redacted]",
    );
    for (const text of [`/handoffs/done/${ID}`, "/handoffs/resume", "/dashboard/settings"]) {
      assert.equal(redactHandoffSecrets(text), text);
    }
  });

  test("a provider error is one redacted line, with its codes and none of its request", () => {
    const error = Object.assign(
      new Error(`Invalid URL: return_url https://app.louez.test/handoffs/return/${ID}/${STATE}`),
      {
        type: "StripeInvalidRequestError",
        statusCode: 400,
        raw: { param: "return_url", url: `/handoffs/return/${ID}/${STATE}` },
      },
    );
    const line = describeProviderError(error);
    assert.ok(!line.includes(STATE), line);
    assert.match(line, /type=StripeInvalidRequestError, statusCode=400/);
    // A thrown text is never kept.
    assert.equal(describeProviderError(`/handoffs/${ID}${SECRET}`), "NonError: a thrown string");
  });

  test("Stripe's onboarding error echoing the return URL prints no state on stdout or stderr", async () => {
    const returnUrl = `https://app.louez.test/handoffs/return/${ID}/${STATE}`;
    const client: StripeConnectClient = {
      accounts: {
        create: async () => ({ id: "acct_x" }),
        retrieve: async () => ({ country: "FR", charges_enabled: false }),
        createLoginLink: async () => ({ url: "https://connect.stripe.test/login" }),
      },
      accountLinks: {
        create: async () => {
          throw Object.assign(new Error(`Not a valid URL: return_url=${returnUrl}`), {
            raw: { return_url: returnUrl },
          });
        },
      },
    };
    const output = await captureOutput(() =>
      startConnectOnboarding({
        client,
        store: {
          id: "store_x",
          userId: "user_x",
          name: "Brest Surf",
          slug: "brest-surf",
          description: null,
          email: "a@b.test",
          phone: null,
          settings: { country: "FR" },
          stripeAccountId: "acct_x",
          stripeChargesEnabled: false,
        },
        urls: createTestUrls(),
        returnUrl,
        refreshUrl: returnUrl.replace("/return/", "/refresh/"),
      }),
    );
    assert.match(output, /Stripe onboarding failed/);
    assert.ok(!output.includes(STATE), output);
  });
});
