import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

import { z } from "zod";

import type { BillingSyncConfig } from "@/lib/billing-sync/config";

import { sha256Hex } from "./canonical-json";
import {
  type BillingResponse,
  callBillingService,
  classifyFailure,
  hmacHex,
  readSignedJson,
  requestSigningString,
  responseSigningString,
  verifyResponseSignature,
} from "./client";

// The worked examples of louez-billing docs/api README §4.1 and §4.2. Their test
// secrets are printed there; both sides refuse to start with them.
const REQUEST_SECRET = "test-request-secret-not-for-production";
const RESPONSE_SECRET = "test-response-secret-not-for-production";
const HEARTBEAT_BODY =
  '{"at":"2026-10-24T09:30:00Z","louezVersion":"2.4.0","queue":{"pending":0,"oldestPendingMarkedAt":null,"dead":0,"deadByStore":[],"stalePendingByStore":[],"truncated":false},"invariants":{"billableWithoutBillableAt":0,"completedPaymentsWithoutGross":null,"byStore":[]},"policies":{"etag":"p-7f3a9c2e5b10","lastPullAt":"2026-10-24T09:29:00Z"},"lastSweepAt":"2026-10-24T02:00:12Z","handledRequestIds":[]}';
const HEARTBEAT_SIGNATURE = "2cf4665f91cc7284cb990cc7b641fa3f74f6822b782ecd2b095cbecac2733546";
const POLICIES_SIGNATURE = "f6267d6e83503f847b5a77a8bc676be64c88165909a489c6ade8a9c3d57b0926";
const RESPONSE_BODY =
  '{"serverTime":"2026-10-24T09:30:01Z","policiesEtag":"p-7f3a9c2e5b10","resync":[],"resyncStores":[],"manifestsWanted":[]}';
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const config: BillingSyncConfig = {
  origin: "https://billing.louez.io",
  signingHost: "billing.louez.io",
  outboundKeys: new Map([["louez-req-test", REQUEST_SECRET]]),
  activeKid: "louez-req-test",
  responseKeys: new Map([["billing-res-test", RESPONSE_SECRET]]),
  newStoresFrom: new Date("2027-01-25T00:00:00Z"),
};

const headersOf = (values: Record<string, string>) => new Headers(values);

describe("request signatures (README §4.1)", () => {
  test("the heartbeat example", () => {
    assert.equal(
      sha256Hex(HEARTBEAT_BODY),
      "82245ed4e422293721f6197c89c6cba488c67121604645b0cb6adf61eb15e26f",
    );
    const signed = requestSigningString({
      timestamp: "1792834200",
      method: "POST",
      host: "billing.louez.io",
      pathAndQuery: "/api/v1/louez/heartbeat",
      contract: "1",
      ifNoneMatch: "",
      bodyHash: sha256Hex(HEARTBEAT_BODY),
    });
    assert.equal(
      signed,
      "louez-billing.req.v1\n1792834200\nPOST\nbilling.louez.io/api/v1/louez/heartbeat\n1\n\n82245ed4e422293721f6197c89c6cba488c67121604645b0cb6adf61eb15e26f",
    );
    assert.equal(hmacHex(REQUEST_SECRET, signed), HEARTBEAT_SIGNATURE);
  });

  test("the policy pull with an ETag signs If-None-Match and the empty-body hash", () => {
    const signed = requestSigningString({
      timestamp: "1792834200",
      method: "GET",
      host: "billing.louez.io",
      pathAndQuery: "/api/v1/louez/policies",
      contract: "1",
      ifNoneMatch: '"p-7f3a9c2e5b10"',
      bodyHash: sha256Hex(""),
    });
    assert.equal(
      signed,
      `louez-billing.req.v1\n1792834200\nGET\nbilling.louez.io/api/v1/louez/policies\n1\n"p-7f3a9c2e5b10"\n${EMPTY_HASH}`,
    );
    assert.equal(hmacHex(REQUEST_SECRET, signed), POLICIES_SIGNATURE);
  });
});

describe("response signatures (README §4.2)", () => {
  test("the 200 and 304 examples verify", () => {
    assert.equal(
      sha256Hex(RESPONSE_BODY),
      "a2e116f37255f3e4ffa43900cc6f1e9101dc6ccb93e4e059f30e4b9a3313eb16",
    );
    assert.equal(
      hmacHex(
        RESPONSE_SECRET,
        responseSigningString({
          timestamp: "1792834201",
          status: 200,
          requestSignature: HEARTBEAT_SIGNATURE,
          bodyHash: sha256Hex(RESPONSE_BODY),
        }),
      ),
      "af407db5fbff570a085ed2c1503172370056d0e026257e68830239fdcfb26f29",
    );
    const check = (status: number, body: string, requestSignature: string, signature: string) =>
      verifyResponseSignature({
        headers: headersOf({
          "Billing-Key-Id": "billing-res-test",
          "Billing-Timestamp": "1792834201",
          "Billing-Signature": signature,
        }),
        status,
        body: Buffer.from(body),
        requestSignature,
        responseKeys: config.responseKeys,
        nowSeconds: 1792834230,
      });
    assert.deepEqual(
      check(
        200,
        RESPONSE_BODY,
        HEARTBEAT_SIGNATURE,
        "af407db5fbff570a085ed2c1503172370056d0e026257e68830239fdcfb26f29",
      ),
      { ok: true, kid: "billing-res-test" },
    );
    assert.deepEqual(
      check(
        304,
        "",
        POLICIES_SIGNATURE,
        "c2bfac343aec931c0d867305183e41476fa4ae75a7f80ecdf4c4d21ed694ae39",
      ),
      { ok: true, kid: "billing-res-test" },
    );
  });

  test("a changed body, status, request or kid, or an old timestamp, fails", () => {
    const base = {
      headers: headersOf({
        "Billing-Key-Id": "billing-res-test",
        "Billing-Timestamp": "1792834201",
        "Billing-Signature": "af407db5fbff570a085ed2c1503172370056d0e026257e68830239fdcfb26f29",
      }),
      status: 200,
      body: Buffer.from(RESPONSE_BODY),
      requestSignature: HEARTBEAT_SIGNATURE,
      responseKeys: config.responseKeys,
      nowSeconds: 1792834201,
    };
    assert.equal(verifyResponseSignature(base).ok, true);
    assert.equal(
      verifyResponseSignature({ ...base, body: Buffer.from(`${RESPONSE_BODY} `) }).ok,
      false,
    );
    assert.equal(verifyResponseSignature({ ...base, status: 201 }).ok, false);
    assert.equal(
      verifyResponseSignature({ ...base, requestSignature: POLICIES_SIGNATURE }).ok,
      false,
    );
    assert.equal(verifyResponseSignature({ ...base, nowSeconds: 1792834201 + 301 }).ok, false);
    assert.equal(verifyResponseSignature({ ...base, nowSeconds: 1792834201 - 301 }).ok, false);
    assert.equal(
      verifyResponseSignature({
        ...base,
        responseKeys: new Map([["billing-res-other", RESPONSE_SECRET]]),
      }).ok,
      false,
    );
    assert.equal(verifyResponseSignature({ ...base, headers: headersOf({}) }).ok, false);
  });
});

describe("callBillingService", () => {
  afterEach(() => mock.timers.reset());

  test("sends the README heartbeat byte for byte and verifies the signed answer before parsing", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1792834200_000 });
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return new Response(RESPONSE_BODY, {
        status: 200,
        headers: {
          "Billing-Key-Id": "billing-res-test",
          "Billing-Timestamp": "1792834201",
          "Billing-Signature": "af407db5fbff570a085ed2c1503172370056d0e026257e68830239fdcfb26f29",
          "Billing-Request-Id": "req_1",
        },
      });
    };
    const result = await callBillingService(
      { endpoint: "heartbeat", method: "POST", path: "/heartbeat", json: HEARTBEAT_BODY },
      { config, fetch: fetchStub },
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, "https://billing.louez.io/api/v1/louez/heartbeat");
    const init = seen[0]?.init;
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("louez-key-id"), "louez-req-test");
    assert.equal(headers.get("louez-timestamp"), "1792834200");
    assert.equal(headers.get("louez-signature"), HEARTBEAT_SIGNATURE);
    assert.equal(headers.get("louez-contract"), "1");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("content-encoding"), null);
    assert.equal(
      Buffer.from(init?.body instanceof Uint8Array ? init.body : []).toString(),
      HEARTBEAT_BODY,
    );

    assert.equal(result.kind, "response");
    if (result.kind !== "response") return;
    assert.deepEqual(result.signature, { ok: true, kid: "billing-res-test" });
    assert.equal(result.requestId, "req_1");
  });

  test("signs If-None-Match on a policy pull and accepts the signed 304", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1792834200_000 });
    let sentHeaders = new Headers();
    const fetchStub: typeof fetch = async (_input, init) => {
      sentHeaders = new Headers(init?.headers);
      return new Response(null, {
        status: 304,
        headers: {
          "Billing-Key-Id": "billing-res-test",
          "Billing-Timestamp": "1792834201",
          "Billing-Signature": "c2bfac343aec931c0d867305183e41476fa4ae75a7f80ecdf4c4d21ed694ae39",
        },
      });
    };
    const result = await callBillingService(
      { endpoint: "policies", method: "GET", path: "/policies", ifNoneMatch: '"p-7f3a9c2e5b10"' },
      { config, fetch: fetchStub },
    );
    assert.equal(sentHeaders.get("louez-signature"), POLICIES_SIGNATURE);
    assert.equal(sentHeaders.get("if-none-match"), '"p-7f3a9c2e5b10"');
    assert.equal(sentHeaders.get("content-type"), null);
    assert.equal(result.kind === "response" && result.signature.ok, true);
  });

  test("a forged body is not parsed, and network errors and timeouts never throw", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1792834300_000 });
    const forged = await callBillingService(
      { endpoint: "heartbeat", method: "POST", path: "/heartbeat", json: "{}" },
      {
        config,
        fetch: async () =>
          new Response(RESPONSE_BODY, {
            status: 200,
            headers: {
              "Billing-Key-Id": "billing-res-test",
              "Billing-Timestamp": "1792834300",
              "Billing-Signature": "0".repeat(64),
            },
          }),
      },
    );
    assert.equal(forged.kind, "response");
    if (forged.kind === "response") {
      assert.equal(forged.signature.ok, false);
      assert.deepEqual(readSignedJson(forged, z.object({ serverTime: z.string() })), {
        ok: false,
        reason: "invalid response signature",
      });
    }

    mock.timers.setTime(1792834301_000);
    const refused = await callBillingService(
      { endpoint: "events", method: "POST", path: "/events", json: "{}" },
      {
        config,
        fetch: async () => {
          throw new TypeError("fetch failed", {
            cause: new Error("redirect mode is set to error"),
          });
        },
      },
    );
    assert.deepEqual(refused, {
      kind: "network",
      timeout: false,
      message: "fetch failed: redirect mode is set to error",
    });

    mock.timers.setTime(1792834302_000);
    const timedOut = await callBillingService(
      { endpoint: "events", method: "POST", path: "/events", json: "{}" },
      {
        config,
        fetch: async () => {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
      },
    );
    assert.equal(timedOut.kind === "network" && timedOut.timeout, true);
  });
});

describe("classifyFailure (README §6)", () => {
  const response = (
    status: number,
    body: unknown,
    retryAfterSeconds: number | null = null,
  ): BillingResponse => ({
    kind: "response",
    status,
    body: Buffer.from(JSON.stringify(body)),
    signature: { ok: false, reason: "unsigned" },
    retryAfterSeconds,
    requestId: null,
  });

  test("maps each status to what Louez does", () => {
    assert.equal(classifyFailure(response(429, {}, 30)).kind, "retry_after");
    assert.equal(classifyFailure(response(503, {}, 30)).kind, "retry_after");
    assert.deepEqual(classifyFailure(response(503, {})), {
      kind: "transport",
      serverError: true,
      detail: "HTTP 503",
    });
    assert.equal(classifyFailure(response(429, {})).kind, "transport");
    assert.equal(classifyFailure(response(401, { code: "invalid_signature" })).kind, "auth");
    assert.deepEqual(classifyFailure(response(401, { code: "replayed_request" })), {
      kind: "transport",
      serverError: false,
      detail: "HTTP 401 replayed_request",
    });
    assert.equal(classifyFailure(response(406, { code: "unsupported_contract" })).kind, "contract");
    assert.deepEqual(classifyFailure(response(502, "bad gateway")), {
      kind: "transport",
      serverError: true,
      detail: "HTTP 502",
    });
    assert.deepEqual(classifyFailure({ kind: "network", timeout: true, message: "aborted" }), {
      kind: "transport",
      serverError: true,
      detail: "timeout",
    });
  });
});
