import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { z } from "zod";

import { describeProviderError, sanitizeCode, sanitizeError, sanitizeText } from "./sanitize-error";

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
    assert.match(clean, /Authorization: \[redacted\]/);
    assert.match(clean, /https:\/\/app\.louez\.test\/api\/oauth\/callback\?\[redacted\]/);
    assert.match(clean, /select \* from customers where email = \?/);
    assert.match(clean, /params: \[redacted\]/);
    assert.match(clean, new RegExp(`/handoffs/${HANDOFF}\\[redacted\\]`));
  });

  test("text that holds nothing sensitive is kept as it is", () => {
    const text =
      "Cannot read properties of undefined (reading 'length') at packages/api/src/services/launch.ts:225";
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

// What a review found still leaking, and inputs crafted to make a pattern slow.
describe("sanitizing errors: whole values, structured errors, linear time", () => {
  test("a cookie header loses its whole value, every cookie in it", () => {
    for (const header of ["Cookie", "Set-Cookie", "cookie"]) {
      const clean = sanitizeText(
        `request failed\n${header}: session=FAKE_SESSION; refresh=FAKE_REFRESH_SECRET\nnext line`,
      );
      assert.ok(!clean.includes("FAKE_SESSION") && !clean.includes("FAKE_REFRESH_SECRET"), clean);
      assert.match(clean, new RegExp(`${header}: \\[redacted\\]\nnext line`));
    }
  });

  test("a sensitive key's quoted value goes whole, in JSON or key=value form, any quoting", () => {
    const cases = [
      `{"password":"FAKE first second"}`,
      `{ "password" : "FAKE first second" }`,
      `{'password': 'FAKE first second'}`,
      `password="FAKE first second" next`,
      `password='FAKE first second'`,
      `{"client_secret":"FAKE first \\" second"}`,
      `{"token":"FAKE first second`,
    ];
    for (const text of cases) {
      const clean = sanitizeText(text);
      for (const word of ["FAKE", "first", "second"]) {
        assert.ok(!clean.includes(word), `${word} survived in ${clean}`);
      }
    }
    assert.equal(sanitizeText(`{"password":"FAKE first second"}`), `{"password":"[redacted]"}`);
  });

  test("a value a database quotes back goes whole, quotes in it included", () => {
    const clean = sanitizeText(
      "Duplicate entry 'O'Brien-CANARY_PRIVATE_VALUE' for key 'customers.customers_email_unique'",
    );
    assert.ok(!clean.includes("Brien") && !clean.includes("CANARY"), clean);
    assert.equal(clean, "Duplicate entry '[redacted]' for key 'customers.customers_email_unique'");
    // Cut before the words that follow it: masked to the line's end.
    assert.ok(!sanitizeText("Duplicate entry 'O'Brien-CANARY_PRIVATE_VALUE").includes("CANARY"));
  });

  test("a MySQL error keeps its code and the names it gives, never its message", () => {
    const sqlMessage =
      "Duplicate entry 'O'Brien-CANARY_PRIVATE_VALUE' for key 'customers.customers_email_unique'";
    const driver = Object.assign(new Error(sqlMessage), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
      sqlMessage,
      sql: "insert into `customers` (`email`) values ('O''Brien-CANARY_PRIVATE_VALUE')",
    });
    // As Drizzle throws it: the query with its parameters, the driver's error as cause.
    const error = new Error(
      "Failed query: insert into `customers` (`email`, `note`) values (?, 'CANARY_LITERAL')\nparams: CANARY_PARAM,0612345678",
      { cause: driver },
    );
    const facts = sanitizeError(error);
    assert.equal(
      facts.message,
      "Failed query: insert into `customers` (`email`, `note`) values (?, '[redacted]')\nparams: [redacted]",
    );
    assert.equal(facts.cause?.message, "ER_DUP_ENTRY (1062): key customers.customers_email_unique");
    assert.equal(facts.cause?.code, "ER_DUP_ENTRY");
    const text = JSON.stringify(facts);
    for (const canary of ["CANARY", "Brien", "0612345678"]) {
      assert.ok(!text.includes(canary), `${canary} in ${text}`);
    }

    const truncated = Object.assign(new Error("Data too long for column 'phone' at row 1"), {
      code: "ER_DATA_TOO_LONG",
      errno: 1406,
    });
    assert.equal(sanitizeError(truncated).message, "ER_DATA_TOO_LONG (1406): column phone");
    const missing = Object.assign(new Error("Table 'louez.received_invoices' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
      sqlMessage: "Table 'louez.received_invoices' doesn't exist",
    });
    assert.equal(
      sanitizeError(missing).message,
      "ER_NO_SUCH_TABLE (1146): table louez.received_invoices",
    );
    const foreign = Object.assign(
      new Error(
        "Cannot add or update a child row: a foreign key constraint fails (`louez`.`payments`, CONSTRAINT `payments_reservation_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`))",
      ),
      { code: "ER_NO_REFERENCED_ROW_2", errno: 1452 },
    );
    assert.equal(
      sanitizeError(foreign).message,
      "ER_NO_REFERENCED_ROW_2 (1452): constraint payments_reservation_fk",
    );
  });

  test("a validation error keeps its issues' codes and paths, never their messages", () => {
    const parsed = z
      .object({
        customer: z.object({
          phone: z.string().regex(/^\+33/, { message: "0612345678 is not a French phone" }),
        }),
        "a key with 0612345678": z.number(),
      })
      .safeParse({ customer: { phone: "0612345678" }, "a key with 0612345678": "x" });
    assert.ok(!parsed.success);
    const facts = sanitizeError(parsed.error);
    assert.equal(
      facts.message,
      "Invalid input: invalid_format at customer.phone; invalid_type at [key]",
    );
    // oRPC wraps it: the cause carries the issues.
    const wrapped = sanitizeError(new Error("Input validation failed", { cause: parsed.error }));
    assert.equal(wrapped.cause?.message, facts.message);
    assert.ok(!JSON.stringify(wrapped).includes("0612345678"));
  });

  test("a message is cut before it is read, without the word the cut split", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
    const clean = sanitizeText(`${"word ".repeat(199)}${token}`);
    assert.ok(clean.length <= 1_001);
    assert.ok(!clean.includes("eyJ"), clean);
  });

  test("a megabyte of crafted text is sanitized in well under 50 ms", () => {
    const MB = 1_000_000;
    const inputs = {
      letters: "x".repeat(MB),
      ats: "a@".repeat(MB / 2),
      dots: "a.".repeat(MB / 2),
      base64: "QmxvYkNhbmFyeQ".repeat(MB / 14),
      equals: "=".repeat(MB),
      pluses: "+".repeat(MB),
      paths: "/a".repeat(MB / 2),
      schemes: "a://".repeat(MB / 4),
      queries: "a?".repeat(MB / 2),
      entries: "Duplicate entry '".repeat(MB / 17),
      keys: 'password="'.repeat(MB / 10),
      digits: "+3".repeat(MB / 2),
      slashes: "/".repeat(MB),
      slashedWords: "a/".repeat(MB / 2),
      paddedBase64: `${"QUJD".repeat(MB / 8)}${"=".repeat(MB / 2)}`,
      hex: "a1".repeat(MB / 2),
    };
    for (const [name, text] of Object.entries(inputs)) {
      const started = performance.now();
      sanitizeText(text);
      sanitizeError(Object.assign(new Error(text), { stack: `Error\n    at ${text}` }));
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 50, `${name}: ${elapsed.toFixed(1)} ms`);
    }
  });

  test("each pattern is linear: 200 KB read whole, uncut, stays fast", () => {
    const size = 200_000;
    for (const text of [
      "x".repeat(size),
      "a@".repeat(size / 2),
      "a.".repeat(size / 2),
      "a://".repeat(size / 4),
      "/a".repeat(size / 2),
      "+".repeat(size),
      "/".repeat(size),
      "=".repeat(size),
      "QUJD".repeat(size / 4),
      "a-".repeat(size / 2),
      "password=".repeat(size / 9),
      "Duplicate entry ".repeat(size / 16),
      "Key (a)=(".repeat(size / 9),
    ]) {
      const started = performance.now();
      sanitizeText(text, size);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 250, `${text.slice(0, 12)}…: ${elapsed.toFixed(1)} ms`);
    }
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

  test("a frame's path, from the repository's root, and position stay", () => {
    assert.equal(
      sanitizeText("at listInbox (/app/packages/api/src/services/inbox.ts:1723:9)"),
      "at listInbox (packages/api/src/services/inbox.ts:1723:9)",
    );
  });
});

// What a review of error tracking found: a quoted name, a machine's paths, codes.
describe("sanitizing errors: names in quotes, paths, codes", () => {
  test("a name with a quote in a duplicate entry goes whole", () => {
    const canary = "O'Brien-private-name-canary";
    for (const text of [
      `Duplicate entry '${canary}' for key 'customers.customers_email_unique'`,
      `Duplicate entry '${canary}'`,
      `Duplicate entry '${canary}' (errno 1062)`,
    ]) {
      const clean = sanitizeText(text);
      assert.ok(!clean.includes("Brien") && !clean.includes("canary"), clean);
    }
    const driver = Object.assign(
      new Error(`Duplicate entry '${canary}' for key 'customers.customers_email_unique'`),
      { code: "ER_DUP_ENTRY", errno: 1062 },
    );
    assert.equal(
      sanitizeError(driver).message,
      "ER_DUP_ENTRY (1062): key customers.customers_email_unique",
    );
  });

  test("an absolute path is named from the repository's root, or not at all", () => {
    const cases: Array<[string, string]> = [
      [
        "ENOENT: no such file or directory, open '/app/apps/web/.next/server/app-paths-manifest.json'",
        "ENOENT: no such file or directory, open 'apps/web/.next/server/app-paths-manifest.json'",
      ],
      [
        "at load (/Users/jane-doe/Developer/Louez/packages/api/src/services/inbox.ts:4:2)",
        "at load (packages/api/src/services/inbox.ts:4:2)",
      ],
      [
        "at query (file:///app/node_modules/.pnpm/mysql2@3.14.0/node_modules/mysql2/lib/conn.js:1:1)",
        "at query (node_modules/.pnpm/mysql2@3.14.0/node_modules/mysql2/lib/conn.js:1:1)",
      ],
      [
        "EACCES: permission denied, open '/Users/jane-doe/.ssh/id_rsa'",
        "EACCES: permission denied, open '[path]'",
      ],
      ["cannot read /home/jane-doe/notes.txt", "cannot read [path]"],
      ["spawn C:\\Users\\jane-doe\\Louez\\apps\\web\\x.js failed", "spawn apps/web/x.js failed"],
      ["spawn C:\\Users\\jane-doe\\secret.txt failed", "spawn [path] failed"],
    ];
    for (const [text, expected] of cases) {
      assert.equal(sanitizeText(text), expected);
    }
    // A route or a URL is no file.
    for (const text of [
      "GET /dashboard/settings/billing failed",
      "POST https://app.louez.test/api/rpc/inbox failed",
    ]) {
      assert.equal(sanitizeText(text), text);
    }
  });

  test("a code is kept only when it is a short code", () => {
    for (const code of [
      "ER_DUP_ENTRY",
      "ENOENT",
      "card_declined",
      "StripeCardError",
      "auth.expired",
    ]) {
      assert.equal(sanitizeCode(code), code);
    }
    assert.equal(sanitizeCode(1062), "1062");
    for (const code of ["", "has space", "a@b.test", "x".repeat(65), "Bearer abc", 1.5, null, {}]) {
      assert.equal(sanitizeCode(code), undefined);
    }
    // An error's code that is no code is left out.
    const facts = sanitizeError(
      Object.assign(new Error("boom"), { code: "jane@example.test", type: "a b" }),
    );
    assert.equal(facts.code, undefined);
    assert.equal(facts.type, undefined);
  });
});
