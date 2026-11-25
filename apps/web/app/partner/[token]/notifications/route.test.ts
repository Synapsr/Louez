import assert from "node:assert/strict";
import { before, describe, mock, test } from "node:test";

import { NextRequest } from "next/server";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

closeNetworkForSuite();

// The partner's e-mail settings without a database: one known secret.
const saved: unknown[] = [];
mock.module("@louez/api/services/partner-space", {
  namedExports: {
    updatePartnerNotifications: async (token: string, value: unknown) => {
      if (token !== "known") return false;
      saved.push(value);
      return true;
    },
  },
});

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

const call = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`https://app.louez.test/partner/${token}/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );

const VALUE = { email: "compta@les-pins.test", bookings: false, payouts: true, statements: true };

describe("a partner's e-mail settings", () => {
  test("saves the choice the space sends", async () => {
    const response = await call("known", VALUE);
    assert.equal(response.status, 200);
    assert.deepEqual(saved.at(-1), VALUE);
  });

  test("an empty address means the store's contact for it", async () => {
    await call("known", { ...VALUE, email: "" });
    assert.deepEqual(saved.at(-1), { ...VALUE, email: null });
  });

  test("another site, a form, a bad value or an unknown secret change nothing", async () => {
    const count = saved.length;
    const responses = await Promise.all([
      call("known", VALUE, { "sec-fetch-site": "cross-site" }),
      call("known", "bookings=false", { "content-type": "application/x-www-form-urlencoded" }),
      call("known", { ...VALUE, email: "not-an-email" }),
      call("unknown", VALUE),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [403, 403, 400, 404],
    );
    assert.equal(saved.length, count);
  });
});
