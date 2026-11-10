import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeProviderError, sanitizeError, sanitizeText } from "./sanitize-error";

// Fake values only: what an error's message may carry, and must not reach a log.
const EMAIL = "alice@example.test";
const BEARER = "FAKE_TOKEN_abcdef123456";
const BASIC = "YWxpY2U6c2VjcmV0cGFzcw==";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImVtYWlsIjoiYUBiLmMifQ.c2lnbmF0dXJlX2Zha2U";
const LOUEZ_KEY = "lz_ab12_Zx9Yw8Vu7Ts6Rq5Po4Nm";
const STRIPE_KEY = "sk_test_51FakeFakeFakeFake";
const WEBHOOK_SECRET = "whsec_FakeFakeFake1234";
const CLIENT_SECRET = "pi_3FakeIntent1234_secret_FakeSecret5678";
const QUERY = "code=oauth_code_123&state=xyz789";
const PASSWORD = "hunter2-fake";
const HANDOFF = "abcdefghijklmnopqrstu"; // a handoff's 21-character id
const HANDOFF_SECRET = "SECRETSECRETSECRET";

const SENSITIVE = [
  EMAIL,
  BEARER,
  BASIC,
  JWT,
  LOUEZ_KEY,
  STRIPE_KEY,
  WEBHOOK_SECRET,
  CLIENT_SECRET,
  "oauth_code_123",
  "xyz789",
  PASSWORD,
  HANDOFF_SECRET,
  "ada@ib.test",
  "0612345678",
];

const assertClean = (text: string) => {
  for (const value of SENSITIVE) assert.ok(!text.includes(value), `${value} in ${text}`);
};

describe("sanitizing errors", () => {
  test("a message loses e-mails, credentials, keys, tokens, query strings and query parameters", () => {
    const text = [
      `Duplicate entry '${EMAIL}' for key 'customers_email'`,
      `request failed: Authorization: Bearer ${BEARER}`,
      `Authorization: Basic ${BASIC}`,
      `id_token=${JWT} and a bare ${JWT}`,
      `x-api-key: ${LOUEZ_KEY}; key ${STRIPE_KEY}; ${WEBHOOK_SECRET}; ${CLIENT_SECRET}`,
      `GET https://app.louez.test/api/oauth/callback?${QUERY}#frag`,
      `https://user:${PASSWORD}@db.louez.test/louez`,
      `{"password":"${PASSWORD}"} password=${PASSWORD}`,
      `https://app.louez.test/handoffs/${HANDOFF}${HANDOFF_SECRET}`,
      "Failed query: select * from customers where email = ?\nparams: ada@ib.test,0612345678",
    ].join("\n");
    const clean = sanitizeText(text);
    assertClean(clean);
    // What helps to debug stays.
    assert.match(clean, /Duplicate entry '\[redacted\]' for key 'customers_email'/);
    assert.match(clean, /Authorization: Bearer \[redacted\]/);
    assert.match(clean, /https:\/\/app\.louez\.test\/api\/oauth\/callback\?\[redacted\]/);
    assert.match(clean, /select \* from customers where email = \?/);
    assert.match(clean, /params: \[redacted\]/);
    assert.match(clean, new RegExp(`/handoffs/${HANDOFF}\\[redacted\\]`));
  });

  test("text that holds nothing sensitive is kept as it is", () => {
    const text =
      "Cannot read properties of undefined (reading 'length') at /app/services/launch.ts:225";
    assert.equal(sanitizeText(text), text);
  });

  test("a long message is cut", () => {
    const clean = sanitizeText("x".repeat(5_000));
    assert.ok(clean.length <= 1_001);
  });

  test("an error keeps its allowlisted fields only, sanitized, with its frames and cause", () => {
    const cause = new Error(`connect failed for ${EMAIL}`);
    const error = Object.assign(
      new Error(`Authorization: Bearer ${BEARER} for ${EMAIL}`, { cause }),
      {
        code: "ER_DUP_ENTRY",
        type: "StripeInvalidRequestError",
        statusCode: 400,
        // Never kept: what a provider echoes of the request.
        raw: { headers: { authorization: `Bearer ${BEARER}` }, email: EMAIL },
        sql: `insert into customers values ('${EMAIL}')`,
      },
    );
    const facts = sanitizeError(error);
    assert.deepEqual(Object.keys(facts).sort(), [
      "cause",
      "code",
      "frames",
      "message",
      "name",
      "statusCode",
      "type",
    ]);
    assert.equal(facts.name, "Error");
    assert.equal(facts.code, "ER_DUP_ENTRY");
    assert.equal(facts.statusCode, 400);
    assert.ok(facts.frames.length > 0 && facts.frames.every((frame) => frame.startsWith("at ")));
    assert.match(facts.cause?.message ?? "", /connect failed for \[redacted\]/);
    assertClean(JSON.stringify(facts));
  });

  test("a stack frame loses what its line holds, and the frames are capped", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      ...Array.from(
        { length: 30 },
        (_, index) => `    at handler (https://app.louez.test/x?${QUERY}:${index}:1)`,
      ),
    ].join("\n");
    const facts = sanitizeError(error, { frames: 5 });
    assert.equal(facts.frames.length, 5);
    assertClean(JSON.stringify(facts));
  });

  test("a thrown value that is no error gives no more than its text, sanitized", () => {
    assert.deepEqual(sanitizeError(`token=${BEARER}`), {
      name: "NonError",
      message: "token=[redacted]",
      frames: [],
    });
    const thrown = sanitizeError({ email: EMAIL, token: BEARER });
    assert.equal(thrown.message, "a thrown object");
    assertClean(JSON.stringify(thrown));
  });

  test("a provider error is one sanitized line with its codes", () => {
    const error = Object.assign(new Error(`No such customer: ${EMAIL}`), {
      type: "StripeInvalidRequestError",
      statusCode: 404,
    });
    assert.equal(
      describeProviderError(error),
      "Error: No such customer: [redacted] (type=StripeInvalidRequestError, statusCode=404)",
    );
    assertClean(describeProviderError(new Error(`Authorization: Bearer ${BEARER}`)));
  });
});

// What error tracking adds to the list (docs/architecture/error-tracking.md).
describe("sanitizing errors for error tracking", () => {
  const canaries = {
    publishable: "pk_live_51FakeCanaryPublishable",
    posthog: "phc_FakeCanaryPostHog123",
    github: "ghp_FakeCanaryGitHubToken1234",
    slack: "xoxb-1234-FakeCanary-slack",
    aws: "AKIAFAKECANARY123456",
    path: "files-key-canary",
    bad: "Jean Dupont",
    pgKey: "bob@example.test",
    pgRow: "Robert Durand",
    phone: "+33 6 12 34 56 78",
    hex: "a1".repeat(20),
    base64: `Q2FuYXJ5${"QmxvYkNhbmFyeQ".repeat(4)}`,
  };

  test("other keys, a bare path's query, the values a database quotes, phones and blobs", () => {
    const text = [
      `${canaries.publishable} ${canaries.posthog} ${canaries.github} ${canaries.slack} ${canaries.aws}`,
      `GET /api/files/source?key=${canaries.path} failed`,
      `Incorrect integer value: '${canaries.bad}' for column 'quantity' at row 1`,
      `Key (email)=(${canaries.pgKey}) already exists.`,
      `Failing row contains (42, ${canaries.pgRow}, null).`,
      `SMS to ${canaries.phone} failed`,
      `digest ${canaries.hex} blob ${canaries.base64}`,
    ].join("\n");
    const clean = sanitizeText(text);
    for (const [name, value] of Object.entries(canaries)) {
      assert.ok(!clean.includes(value), `${name} survived in ${clean}`);
    }
    // What says what broke stays: the path, the column, the key's name.
    assert.match(clean, /GET \/api\/files\/source\?\[redacted\] failed/);
    assert.match(clean, /for column 'quantity' at row 1/);
    assert.match(clean, /Key \(email\)=\(\[redacted\]\) already exists\./);
  });

  test("ids, tables, codes and numbers stay", () => {
    const text =
      "Store store_V1StGXR8_Z5jdHi6B-myT has no row in reservation_items (ER_NO_REFERENCED_ROW_2, 1452)";
    assert.equal(sanitizeText(text), text);
  });

  test("a frame's path and position stay", () => {
    const frame = "at listInbox (/app/packages/api/src/services/inbox.ts:1723:9)";
    assert.equal(sanitizeText(frame), frame);
  });
});
