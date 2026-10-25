import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BillingResponse } from "./client";
import {
  MAX_BATCH_EVENTS,
  MAX_BODY_BYTES,
  MAX_EVENT_BYTES,
  classifyEventsResponse,
  packEventBatches,
  planRejection,
  planServerErrorAlone,
  resultAction,
} from "./relay";

// The relay's rules for results, backoff and batches (louez-billing docs/api, README
// §5.3, §5.6 and §6).

const signed = (status: number, body: unknown): BillingResponse => ({
  kind: "response",
  status,
  body: Buffer.from(JSON.stringify(body)),
  signature: { ok: true, kid: "billing-res-test" },
  retryAfterSeconds: null,
  requestId: null,
});

const result = (status: "accepted" | "duplicate" | "stale" | "rejected", code?: string) => ({
  id: "reservation.snapshot:r1:3",
  status,
  heldVersion: 3,
  error: code ? { code, message: "a rule", path: "/data/payments/0" } : null,
});

describe("resultAction", () => {
  test("accepted, duplicate and stale are delivered", () => {
    for (const status of ["accepted", "duplicate", "stale"] as const) {
      assert.deepEqual(resultAction(result(status)), { kind: "delivered", heldVersion: 3 });
    }
  });

  test("id_reused is not an attempt; processing_failed and other codes are", () => {
    assert.deepEqual(resultAction(result("rejected", "id_reused")), {
      kind: "id_reused",
      heldVersion: 3,
    });
    assert.deepEqual(resultAction(result("rejected", "processing_failed")), {
      kind: "processing_failed",
      error: "processing_failed at /data/payments/0: a rule",
    });
    assert.deepEqual(resultAction(result("rejected", "invalid_data")), {
      kind: "rejected",
      error: "invalid_data at /data/payments/0: a rule",
    });
  });
});

describe("planRejection", () => {
  test("processing_failed waits min(60, 2^attempts) minutes and never dies", () => {
    assert.deepEqual(
      [0, 1, 4, 5, 9, 40].map((attempts) => planRejection("processing_failed", attempts)),
      [
        { attemptCount: 1, delayMinutes: 2, dead: false },
        { attemptCount: 2, delayMinutes: 4, dead: false },
        { attemptCount: 5, delayMinutes: 32, dead: false },
        { attemptCount: 6, delayMinutes: 60, dead: false },
        { attemptCount: 10, delayMinutes: 60, dead: false },
        { attemptCount: 41, delayMinutes: 60, dead: false },
      ],
    );
  });

  test("other rejections wait 2^attempts minutes and die at the fifth", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((attempts) => planRejection("rejected", attempts)),
      [
        { attemptCount: 1, delayMinutes: 2, dead: false },
        { attemptCount: 2, delayMinutes: 4, dead: false },
        { attemptCount: 3, delayMinutes: 8, dead: false },
        { attemptCount: 4, delayMinutes: 16, dead: false },
        { attemptCount: 5, delayMinutes: 32, dead: true },
      ],
    );
  });
});

describe("planServerErrorAlone", () => {
  test("the third 5xx or timeout in a row makes the row dead", () => {
    assert.deepEqual(planServerErrorAlone(null), { count: 1, dead: false });
    assert.deepEqual(planServerErrorAlone("server_error 1/3: HTTP 502"), { count: 2, dead: false });
    assert.deepEqual(planServerErrorAlone("server_error 2/3: timeout"), { count: 3, dead: true });
    // Another error in between restarts the count.
    assert.deepEqual(planServerErrorAlone("invalid_data: a rule"), { count: 1, dead: false });
  });
});

describe("packEventBatches", () => {
  test("at most 100 events per request", () => {
    const events = Array.from({ length: 250 }, () => ({ bytes: 10 }));
    assert.deepEqual(
      packEventBatches(events).map((batch) => batch.length),
      [MAX_BATCH_EVENTS, MAX_BATCH_EVENTS, 50],
    );
  });

  test("at most 1,048,576 bytes of body, measured with the wrapper and commas", () => {
    // Three events of the largest size fit in 1 MB; a fourth would pass it.
    const large = Array.from({ length: 5 }, () => ({ bytes: MAX_EVENT_BYTES }));
    const batches = packEventBatches(large);
    for (const batch of batches) {
      const body =
        Buffer.byteLength('{"events":[]}') +
        batch.reduce((sum, e) => sum + e.bytes, 0) +
        batch.length -
        1;
      assert.ok(body <= MAX_BODY_BYTES, `a batch of ${body} bytes`);
    }
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [3, 2],
    );
    // Exactly full: 1,048,576 − 13 bytes of events and commas in one request.
    const exact = [{ bytes: MAX_BODY_BYTES - 13 - 1 - 100 }, { bytes: 100 }];
    assert.deepEqual(
      packEventBatches(exact).map((batch) => batch.length),
      [2],
    );
    assert.deepEqual(
      packEventBatches([{ bytes: MAX_BODY_BYTES - 13 - 100 }, { bytes: 100 }]).map((b) => b.length),
      [1, 1],
    );
  });
});

describe("classifyEventsResponse", () => {
  test("a verified 200 with one result per event", () => {
    const outcome = classifyEventsResponse(
      signed(200, { results: [result("accepted"), result("rejected", "invalid_data")] }),
      2,
    );
    assert.equal(outcome.kind, "results");
  });

  test("a 200 that fails its signature, or with the wrong count, is a transport failure", () => {
    const unsigned: BillingResponse = {
      ...signed(200, { results: [result("accepted")] }),
      signature: { ok: false, reason: "invalid response signature" },
    };
    assert.deepEqual(classifyEventsResponse(unsigned, 1), {
      kind: "transport",
      serverError: false,
      detail: "invalid response signature",
    });
    assert.deepEqual(classifyEventsResponse(signed(200, { results: [] }), 1), {
      kind: "transport",
      serverError: false,
      detail: "0 results for 1 events",
    });
  });

  test("a verified 400 or any 413 is a limit; an unsigned 400 is not", () => {
    assert.equal(classifyEventsResponse(signed(400, { code: "invalid_request" }), 3).kind, "limit");
    assert.equal(
      classifyEventsResponse(
        {
          ...signed(413, { code: "payload_too_large" }),
          signature: { ok: false, reason: "unsigned" },
        },
        3,
      ).kind,
      "limit",
    );
    assert.equal(
      classifyEventsResponse(
        {
          ...signed(400, { code: "invalid_request" }),
          signature: { ok: false, reason: "unsigned" },
        },
        3,
      ).kind,
      "transport",
    );
  });

  test("429 and 503 with Retry-After wait; 401 and 406 stop", () => {
    assert.equal(
      classifyEventsResponse({ ...signed(503, {}), retryAfterSeconds: 60 }, 1).kind,
      "retry_after",
    );
    assert.equal(
      classifyEventsResponse(signed(401, { code: "timestamp_out_of_window" }), 1).kind,
      "auth",
    );
    assert.equal(
      classifyEventsResponse(signed(406, { code: "unsupported_contract" }), 1).kind,
      "contract",
    );
    assert.deepEqual(classifyEventsResponse({ kind: "network", timeout: true, message: "x" }, 1), {
      kind: "transport",
      serverError: true,
      detail: "timeout",
    });
  });
});
