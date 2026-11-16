import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chatRequestRefusal, type AppOrigins } from "./chat-request";

// Same origin is decided against the origins the app is served on (its
// configured URL, and those the auth layer trusts), never against the URL
// the request reached the server with nor a forwarded header. Every request
// here reaches the route as a reverse proxy hands it: on its upstream URL.

const UPSTREAM = "https://127.0.0.1:60441/api/chat";

const chat = (headers: Record<string, string>) =>
  new Request(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });

const accepted = (headers: Record<string, string>, app: AppOrigins) =>
  chatRequestRefusal(chat(headers), app) === null;

/** A development checkout: the configured app URL, and the project's Localify hosts. */
const DEVELOPMENT: AppOrigins = {
  appUrl: "https://louez.localify",
  authUrl: "https://louez.localify",
  development: true,
};

/** Production: the configured app URL alone. */
const PRODUCTION: AppOrigins = {
  appUrl: "https://app.louez.test",
  authUrl: "https://app.louez.test",
  development: false,
};

describe("chatRequestRefusal behind a proxy", () => {
  test("the configured origin is accepted", () => {
    for (const app of [DEVELOPMENT, PRODUCTION]) {
      const origin = new URL(app.appUrl).origin;
      assert.equal(accepted({ origin, "sec-fetch-site": "same-origin" }, app), true, origin);
    }
  });

  test("an origin the auth layer trusts is accepted", () => {
    for (const origin of [
      "https://louez.localify.fyi",
      "https://feat-chat.louez.localify",
      "https://louez--feat-chat.localify.fyi",
    ]) {
      assert.equal(
        accepted({ origin, "sec-fetch-site": "same-origin" }, DEVELOPMENT),
        true,
        origin,
      );
    }
  });

  test("an untrusted origin is refused, whatever a forwarded header says", () => {
    for (const app of [DEVELOPMENT, PRODUCTION]) {
      const origin = "https://elsewhere.test";
      assert.equal(
        accepted(
          {
            origin,
            "x-forwarded-host": "elsewhere.test",
            "x-forwarded-proto": "https",
            host: "elsewhere.test",
          },
          app,
        ),
        false,
      );
    }
  });

  test("another subdomain of the same site is refused", () => {
    assert.equal(
      accepted({ origin: "https://shop.louez.test", "sec-fetch-site": "same-site" }, PRODUCTION),
      false,
    );
    assert.equal(accepted({ origin: "https://shop.louez.test" }, PRODUCTION), false);
    // Production trusts no development host.
    assert.equal(accepted({ origin: "https://louez.localify.fyi" }, PRODUCTION), false);
    // Not one of the project's hosts, nor a host with a port or over plain HTTP.
    for (const origin of [
      "https://other.localify.fyi",
      "https://a.b.louez.localify",
      "https://louez.localify.fyi:8443",
      "http://louez.localify.fyi",
    ]) {
      assert.equal(accepted({ origin }, DEVELOPMENT), false, origin);
    }
  });
});
