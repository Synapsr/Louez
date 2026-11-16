import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  REFUSAL_LOG_BUDGET,
  REFUSAL_LOG_INTERVAL_MS,
  chatRequestRefusal,
  refusalLogLine,
  type AppOrigins,
} from "./chat-request";

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

const accepted = async (headers: Record<string, string>, app: AppOrigins) =>
  (await chatRequestRefusal(chat(headers), app)) === null;

/**
 * The auth layer's answer, as `isTrustedAuthOrigin` gives it from Better
 * Auth's resolver (packages/auth/src/trusted-origins.test.ts holds that
 * resolver to the auth configuration): here, a list.
 */
const trusting =
  (...origins: string[]) =>
  (origin: string) =>
    origins.includes(origin);

/** A development checkout: the configured app URL, and the project's Localify hosts. */
const DEVELOPMENT: AppOrigins = {
  appUrl: "https://louez.localify",
  isTrusted: trusting(
    "https://louez.localify",
    "https://louez.localify.fyi",
    "https://feat-chat.louez.localify",
    "https://louez--feat-chat.localify.fyi",
  ),
};

/** Production, with an alias the operator lists in BETTER_AUTH_TRUSTED_ORIGINS. */
const PRODUCTION: AppOrigins = {
  appUrl: "https://app.example.org",
  isTrusted: trusting("https://app.example.org", "https://alias.example.org"),
};

describe("chatRequestRefusal behind a proxy", () => {
  test("the configured origin is accepted", async () => {
    for (const app of [DEVELOPMENT, PRODUCTION]) {
      const origin = new URL(app.appUrl).origin;
      assert.equal(await accepted({ origin, "sec-fetch-site": "same-origin" }, app), true, origin);
    }
  });

  test("an origin the auth layer trusts is accepted", async () => {
    for (const origin of [
      "https://louez.localify.fyi",
      "https://feat-chat.louez.localify",
      "https://louez--feat-chat.localify.fyi",
    ]) {
      assert.equal(
        await accepted({ origin, "sec-fetch-site": "same-origin" }, DEVELOPMENT),
        true,
        origin,
      );
    }
    // The operator's own alias, in production.
    assert.equal(
      await accepted(
        { origin: "https://alias.example.org", "sec-fetch-site": "same-origin" },
        PRODUCTION,
      ),
      true,
    );
  });

  test("an untrusted origin is refused, whatever a forwarded header says", async () => {
    for (const app of [DEVELOPMENT, PRODUCTION]) {
      const origin = "https://elsewhere.test";
      assert.equal(
        await accepted(
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

  test("an origin in neither list is refused, another subdomain of the site included", async () => {
    for (const origin of [
      "https://shop.example.org",
      "https://alias.example.org.evil.test",
      "https://louez.localify.fyi",
    ]) {
      assert.equal(await accepted({ origin, "sec-fetch-site": "same-site" }, PRODUCTION), false);
      assert.equal(await accepted({ origin }, PRODUCTION), false, origin);
    }
    assert.equal(await accepted({ origin: "https://other.localify.fyi" }, DEVELOPMENT), false);
  });

  test("a refusal logs one line, naming its origin and nothing else, now and then", async () => {
    const request = new Request(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://unlisted.example.org",
        cookie: "session=secret-cookie",
      },
      body: '{"messages":["secret-body"]}',
    });
    const refusal = await chatRequestRefusal(request, PRODUCTION);
    assert.ok(refusal);
    const now = Date.UTC(2030, 5, 1);
    const line = refusalLogLine(refusal, now);
    assert.ok(line);
    assert.match(
      line,
      /refused for its origin: Origin https:\/\/unlisted\.example\.org is not among the configured origins/,
    );
    assert.doesNotMatch(line, /secret-cookie|secret-body|127\.0\.0\.1/);
    assert.equal(refusalLogLine(refusal, now + 1_000), null, "the same origin, soon after");
    assert.ok(refusalLogLine(refusal, now + REFUSAL_LOG_INTERVAL_MS));
  });

  test("refusals from many origins write a bounded number of lines per interval", async () => {
    const refusalOf = async (index: number) => {
      const refusal = await chatRequestRefusal(
        chat({ origin: `https://unlisted-${index}.example.org` }),
        PRODUCTION,
      );
      assert.ok(refusal);
      return refusal;
    };
    const now = Date.UTC(2031, 5, 1);
    let written = 0;
    // More origins than the memory of logged origins holds, twice over: none
    // is written again by being forgotten.
    for (let round = 0; round < 2; round++) {
      for (let index = 0; index < 101; index++) {
        if (refusalLogLine(await refusalOf(index), now) !== null) written += 1;
      }
    }
    assert.equal(written, REFUSAL_LOG_BUDGET);
    assert.ok(
      refusalLogLine(await refusalOf(500), now + REFUSAL_LOG_INTERVAL_MS),
      "the next interval writes again",
    );
  });
});
