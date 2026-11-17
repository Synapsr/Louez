import assert from "node:assert/strict";
import { createServer } from "node:http";
import https from "node:https";
import { describe, test } from "node:test";

import { closeNetworkForSuite } from "./network-guard";

// The guard refuses what leaves this machine, whatever opens the socket, and lets
// a local server through. A refused test is named. The hosts are `.invalid`, which
// never resolve: should the guard miss one, nothing leaves this machine either,
// and the attempts it records say so.

describe("the network guard", () => {
  const known = "a test known to reach out is refused without failing";
  const { attempts } = closeNetworkForSuite({ reportOnly: new Set([known]) });

  test(known, async () => {
    // fetch, through undici.
    await assert.rejects(fetch("https://api.stripe.invalid/v1/charges"));
    // https, as Stripe's client and most SDKs open theirs.
    await assert.rejects(
      new Promise((resolve, reject) => {
        https.get("https://hooks.slack.invalid/", resolve).on("error", reject);
      }),
    );
    assert.deepEqual(
      attempts.map(({ test, host }) => [test, host]),
      [
        [known, "api.stripe.invalid"],
        [known, "hooks.slack.invalid"],
      ],
    );
  });

  test("a local server is reached", async () => {
    const server = createServer((_request, response) => response.end("local"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      assert.equal(await response.text(), "local");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
