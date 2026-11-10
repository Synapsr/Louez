import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { z } from "zod";

import {
  describeProviderError,
  sanitizeCode,
  sanitizeError,
  sanitizeFrame,
  sanitizeText,
} from "./sanitize-error";

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
const PASSWORD = "hunter2-fake";
const HANDOFF = "abcdefghijklmnopqrstu"; // a handoff's 21-character id
const HANDOFF_SECRET = "SECRETSECRETSECRET";

/** No canary survives `text`: each fake value, whole or in any word of six letters or more. */
function assertNone(text: string, canaries: readonly string[]) {
  for (const canary of canaries) {
    for (const part of [canary, ...canary.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 6)]) {
      assert.ok(
        !text.includes(part),
        `${JSON.stringify(part)} survived in ${JSON.stringify(text)}`,
      );
    }
  }
}

describe("sanitizing free text: only its shape stays", () => {
  test("plain words, punctuation and codes stay; anything else is a placeholder", () => {
    assert.equal(
      sanitizeText("Cannot read properties of undefined (reading 'length')"),
      "Cannot read properties of undefined (reading [value])",
    );
    assert.equal(
      sanitizeText("It doesn't work, l'élève est là."),
      "It doesn't work, l'élève est là.",
    );
    assert.equal(
      sanitizeText(
        "Store store_V1StGXR8_Z5jdHi6B-myT has no row in reservation_items (ER_NO_REFERENCED_ROW_2, 1452)",
      ),
      "Store [value] has no row in [value] (ER_NO_REFERENCED_ROW_2, [value])",
    );
    // Runs of blanks and line breaks become one.
    assert.equal(sanitizeText("a  \t b\n\n\n  c"), "a b\nc");
    // A run of placeholders is one (a spaced phone number).
    assert.equal(sanitizeText("SMS to +33 6 12 34 56 78 failed"), "SMS to [value] failed");
    // A word longer than 24 letters is no plain word.
    assert.equal(sanitizeText("a".repeat(25)), "[value]");
  });

  test("e-mails, credentials, keys, tokens, URLs, paths and query parameters go", () => {
    const text = [
      `Duplicate entry '${EMAIL}' for key 'customers_email'`,
      `request failed: Authorization: Bearer ${BEARER}`,
      `Authorization: Basic ${BASIC}`,
      `id_token=${JWT} and a bare ${JWT}`,
      `x-api-key: ${LOUEZ_KEY}`,
      `keys ${STRIPE_KEY} ${WEBHOOK_SECRET} ${CLIENT_SECRET}`,
      "GET https://app.louez.test/api/oauth/callback?code=oauth_code_123&state=xyz789#frag",
      `https://user:${PASSWORD}@db.louez.test/louez`,
      `{"password":"${PASSWORD}"} password=${PASSWORD}`,
      `https://app.louez.test/handoffs/${HANDOFF}${HANDOFF_SECRET}`,
      "Failed query: select * from customers where email = ?\nparams: ada@ib.test,0612345678",
    ].join("\n");
    const clean = sanitizeText(text);
    assertNone(clean, [
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
      HANDOFF,
      HANDOFF_SECRET,
      "ada@ib.test",
      "0612345678",
    ]);
    assert.match(clean, /^Duplicate entry \[value\] for key \[value\]$/m);
    assert.match(clean, /^request failed: Authorization: \[redacted\]$/m);
    assert.match(clean, /^GET https:\/\/app\.louez\.test\[url\]$/m);
    assert.match(clean, /^https:\/\/db\.louez\.test\[url\]$/m);
  });

  test("a long message is cut before it is read, without the word the cut split", () => {
    assert.ok(sanitizeText("word ".repeat(5_000)).length <= 1_040);
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
    assert.ok(!sanitizeText(`${"word ".repeat(199)}${token}`).includes("eyJ"));
  });

  test("text that is no string gives a placeholder", () => {
    assert.equal(sanitizeText(42 as unknown as string), "[value]");
  });
});

// The leak classes a review found in the pattern-based sanitizer, each with variants.
describe("sanitizing free text: what a denylist let through", () => {
  test("1. a JSON cookie's value", () => {
    for (const text of [
      `{"cookie":"session=FAKE_SESSION; refresh=FAKE_REFRESH_SECRET"}`,
      `{ "Cookie" : "session=FAKE_SESSION; refresh=FAKE_REFRESH_SECRET" }`,
      `{'set-cookie': ['session=FAKE_SESSION', 'refresh=FAKE_REFRESH_SECRET']}`,
      `{"cookie":\n  "session=FAKE_SESSION;\n refresh=FAKE_REFRESH_SECRET"}`,
      "Cookie: session=FAKE_SESSION; refresh=FAKE_REFRESH_SECRET",
    ]) {
      assertNone(sanitizeText(text), ["FAKE_SESSION", "FAKE_REFRESH_SECRET"]);
    }
    assert.equal(
      sanitizeText(`{"cookie":"session=FAKE_SESSION; refresh=FAKE_REFRESH_SECRET"}`),
      `{"cookie": [redacted]`,
    );
  });

  test("2. blanks or line breaks after a separator or a scheme", () => {
    for (const text of [
      "Authorization:\n   Bearer FAKE_WS_TOKEN",
      "Authorization:\t\tBearer FAKE_WS_TOKEN",
      "password =\n  FAKE_WS_TOKEN",
      "password=\n\nFAKE_WS_TOKEN",
      "token:   FAKE_WS_TOKEN",
      "Bearer\nFAKE_WS_TOKEN",
      "Bearer \t FAKE_WS_TOKEN",
      "x-api-key :\r\n FAKE_WS_TOKEN",
      `"password"\n:\n"FAKE_WS_TOKEN first second"`,
    ]) {
      assertNone(sanitizeText(text), ["FAKE_WS_TOKEN", "first", "second"]);
    }
    // What follows the redacted line stays.
    assert.equal(
      sanitizeText("Authorization:\n   Bearer FAKE_WS_TOKEN\nthen it failed"),
      "Authorization: [redacted]\nthen it failed",
    );
  });

  test("3. a URL's fragment, query, path and user", () => {
    const clean = sanitizeText(
      "redirect to https://user:FAKE_URL_PASSWORD@app.louez.test:8443/callback/FAKE_URL_PATH?code=FAKE_URL_CODE#access_token=FAKE_URL_FRAGMENT&state=x",
    );
    assert.equal(clean, "redirect to https://app.louez.test:8443[url]");
    assertNone(clean, ["FAKE_URL_PASSWORD", "FAKE_URL_PATH", "FAKE_URL_CODE", "FAKE_URL_FRAGMENT"]);
    assert.equal(sanitizeText("open app://FAKE_URL_HOST_@!x/y"), "open app://[url]");
  });

  test("4. a constraint's name inside a duplicate value", () => {
    const sqlMessage =
      "Duplicate entry 'x CONSTRAINT `FAKE_CONSTRAINT_CANARY` FOREIGN KEY' for key 'customers.customers_email_unique'";
    const facts = sanitizeError(
      Object.assign(new Error(sqlMessage), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage }),
    );
    assert.equal(facts.message, "ER_DUP_ENTRY (1062): key customers.customers_email_unique");
    assertNone(JSON.stringify(facts), ["FAKE_CONSTRAINT_CANARY"]);
    // A value that imitates the end of the message: the name is taken at the message's end only.
    const imitation =
      "Duplicate entry 'v' for key 'FAKE_KEY_CANARY' x' for key 'customers.customers_email_unique'";
    assert.equal(
      sanitizeError(
        Object.assign(new Error(imitation), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
          sqlMessage: imitation,
        }),
      ).message,
      "ER_DUP_ENTRY (1062): key customers.customers_email_unique",
    );
    // A message that does not read as its code says: the code alone.
    assert.equal(
      sanitizeError(
        Object.assign(new Error("Duplicate entry FAKE_ODD_CANARY"), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
        }),
      ).message,
      "ER_DUP_ENTRY (1062)",
    );
  });

  test("5. multiline and double-quoted SQL literals, and Postgres's quoted values", () => {
    const query = sanitizeError(
      new Error(
        `Failed query: insert into "customers" ("note", "email") values ('line one\nFAKE_SQL_LINE_TWO', "FAKE_SQL_DOUBLE")\nparams: FAKE_SQL_PARAM`,
      ),
    );
    assert.equal(
      query.message,
      "Failed query: insert into [value] ([value], [value]) values ([value], [value])\nparams: [redacted]",
    );
    for (const text of [
      `Key (email)=("FAKE_PG_VALUE") already exists.`,
      `Key (email)=(FAKE_PG_VALUE) already exists.`,
      `Failing row contains (42, "FAKE_PG_ROW", null).`,
      `invalid input syntax for type uuid: "FAKE_PG_UUID"`,
    ]) {
      assertNone(sanitizeText(text), ["FAKE_PG_VALUE", "FAKE_PG_ROW", "FAKE_PG_UUID"]);
    }
  });

  test("6. a record's own keys in a validation path", () => {
    const parsed = z
      .object({ attributes: z.record(z.string(), z.number()) })
      .safeParse({ attributes: { sk_test_FakeRecordKey123: "x", "jane.doe@example.test": "y" } });
    assert.ok(!parsed.success);
    const facts = sanitizeError(parsed.error);
    assert.equal(
      facts.message,
      "Invalid input: invalid_type at attributes.[key]; invalid_type at attributes.[key]",
    );
    assertNone(JSON.stringify(facts), ["sk_test_FakeRecordKey123", "jane.doe@example.test"]);
  });

  test("7. base64 split by a slash", () => {
    const blob = "QUJDREVGR0hJSktMTU5PUFFS/U1RVVldYWVphYmNkZWZn/aGlqa2xtbm9wcXJzdHV2d3h5eg==";
    const clean = sanitizeText(`blob ${blob} and ${blob.replaceAll("/", " / ")}`);
    assertNone(clean, [
      "QUJDREVGR0hJSktMTU5PUFFS",
      "U1RVVldYWVphYmNkZWZn",
      "aGlqa2xtbm9wcXJzdHV2d3h5eg",
    ]);
  });

  test("8. paths with spaces", () => {
    for (const [text, expected] of [
      ["open '/Users/Jane Doe/FAKE secret notes.txt' failed", "open [path] failed"],
      [`open "C:\\Users\\Jane Doe\\FAKE secret.txt" failed`, "open [path] failed"],
      ["read /Users/Jane Doe/notes/FAKE.txt failed", "read [path] failed"],
    ] as const) {
      assert.equal(sanitizeText(text), expected);
    }
    assert.equal(
      sanitizeFrame("at load (/Users/Jane Doe/Louez/packages/api/src/services/inbox.ts:4:2)"),
      "at load (packages/api/src/services/inbox.ts:4:2)",
    );
    assert.equal(sanitizeFrame("at load (/Users/Jane Doe/secret.js:4:2)"), "at load ([path]:4:2)");
  });

  test("9. an error that throws, or holds what cannot be read, never makes it throw", () => {
    const throwingMessage = new Error("x");
    Object.defineProperty(throwingMessage, "message", {
      get() {
        throw new Error("FAKE_GETTER_CANARY");
      },
    });
    const throwingEverything = new Error("x");
    for (const key of ["name", "stack", "code", "type", "statusCode", "cause", "issues"]) {
      Object.defineProperty(throwingEverything, key, {
        get() {
          throw new Error("FAKE_GETTER_CANARY");
        },
      });
    }
    const symbolMessage = Object.assign(new Error("x"), { message: Symbol("FAKE_SYMBOL") });
    const objectMessage = Object.assign(new Error("x"), {
      message: {
        toString() {
          throw new Error("FAKE_TOSTRING_CANARY");
        },
      },
    });
    const numberStack = Object.assign(new Error("x"), { stack: 42, name: { evil: true } });
    const cyclic: Error & { cause?: unknown } = new Error("cycle");
    cyclic.cause = cyclic;
    const deep = new Error("0", {
      cause: new Error("1", {
        cause: new Error("2", { cause: new Error("3", { cause: new Error("4") }) }),
      }),
    });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile = new Proxy(new Error("x"), {
      get() {
        throw new Error("FAKE_PROXY_CANARY");
      },
      getPrototypeOf() {
        throw new Error("FAKE_PROXY_CANARY");
      },
    });
    for (const error of [
      throwingMessage,
      throwingEverything,
      symbolMessage,
      objectMessage,
      numberStack,
      cyclic,
      deep,
      proxy,
      hostile,
      Symbol("FAKE_SYMBOL"),
      undefined,
      null,
      BigInt(10),
      () => "FAKE_FUNCTION",
    ]) {
      const facts = sanitizeError(error);
      assert.equal(typeof facts.name, "string");
      assert.equal(typeof facts.message, "string");
      assert.ok(Array.isArray(facts.frames));
      assertNone(JSON.stringify(facts), [
        "FAKE_GETTER_CANARY",
        "FAKE_TOSTRING_CANARY",
        "FAKE_PROXY_CANARY",
        "FAKE_SYMBOL",
        "FAKE_FUNCTION",
      ]);
      assert.doesNotThrow(() => describeProviderError(error));
    }
    assert.equal(sanitizeError(symbolMessage).message, "[value]");
    assert.equal(sanitizeError(numberStack).name, "Error");
    assert.deepEqual(sanitizeError(numberStack).frames, []);
    assert.equal(sanitizeError(cyclic).cause?.message, "[cause cycle]");
    // Causes stop after three levels.
    let depth = 0;
    for (let facts = sanitizeError(deep); facts.cause; facts = facts.cause) depth += 1;
    assert.equal(depth, 3);
    assert.equal(sanitizeError(Symbol("x")).message, "a thrown symbol");
  });
});

describe("sanitizing structured errors", () => {
  test("an error keeps its allowlisted fields only, sanitized, with its frames and cause", () => {
    const cause = new Error(`connect failed for ${EMAIL}`);
    const error = Object.assign(
      new Error(`Authorization: Bearer ${BEARER} for ${EMAIL}`, { cause }),
      {
        code: "ER_SOMETHING",
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
    assert.equal(facts.message, "Authorization: [redacted]");
    assert.equal(facts.code, "ER_SOMETHING");
    assert.equal(facts.statusCode, 400);
    assert.ok(facts.frames.length > 0 && facts.frames.every((frame) => frame.startsWith("at ")));
    assert.equal(facts.cause?.message, "connect failed for [value]");
    assertNone(JSON.stringify(facts), [EMAIL, BEARER]);
  });

  test("a frame keeps its function and its place in the repository", () => {
    for (const [frame, expected] of [
      [
        "at listInbox (/app/packages/api/src/services/inbox.ts:1723:9)",
        "at listInbox (packages/api/src/services/inbox.ts:1723:9)",
      ],
      [
        "at query (file:///app/node_modules/.pnpm/mysql2@3.14.0/node_modules/mysql2/lib/conn.js:1:1)",
        "at query (node_modules/.pnpm/mysql2@3.14.0/node_modules/mysql2/lib/conn.js:1:1)",
      ],
      ["at /Users/jane/Louez/apps/web/x.js:1:2", "at apps/web/x.js:1:2"],
      [
        "at Object.<anonymous> (node:internal/modules/cjs/loader:1638:15)",
        "at Object.<anonymous> (node:internal/modules/cjs/loader:1638:15)",
      ],
      ["at async Promise.all (index 12)", "at async Promise.all (index 12)"],
      ["at handler (https://app.louez.test/x?code=FAKE:0:1)", "at handler ([path]:0:1)"],
      ["at fn (/home/jane/notes.js:1:1)", "at fn ([path]:1:1)"],
      ["at FAKE@evil (packages/a.ts:1:1)", "at [function] ([path]:1:1)"],
      ["not a frame", "at [frame]"],
    ] as const) {
      assert.equal(sanitizeFrame(frame), expected);
    }
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      ...Array.from(
        { length: 30 },
        (_, index) => `    at handler (/app/packages/api/src/x.ts?code=FAKE_FRAME:${index}:1)`,
      ),
    ].join("\n");
    const facts = sanitizeError(error, { frames: 5 });
    assert.equal(facts.frames.length, 5);
    assertNone(JSON.stringify(facts), ["FAKE_FRAME"]);
  });

  test("a MySQL error keeps its code and the name its message gives at its place", () => {
    const named = (code: string, errno: number, sqlMessage: string) =>
      sanitizeError(Object.assign(new Error(sqlMessage), { code, errno, sqlMessage })).message;
    assert.equal(
      named(
        "ER_DUP_ENTRY",
        1062,
        "Duplicate entry 'O'Brien-CANARY_PRIVATE_VALUE' for key 'customers.customers_email_unique'",
      ),
      "ER_DUP_ENTRY (1062): key customers.customers_email_unique",
    );
    assert.equal(
      named("ER_DATA_TOO_LONG", 1406, "Data too long for column 'phone' at row 1"),
      "ER_DATA_TOO_LONG (1406): column phone",
    );
    assert.equal(
      named("ER_BAD_NULL_ERROR", 1048, "Column 'email' cannot be null"),
      "ER_BAD_NULL_ERROR (1048): column email",
    );
    assert.equal(
      named(
        "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD",
        1366,
        "Incorrect integer value: 'Jean Dupont' for column 'quantity' at row 1",
      ),
      "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD (1366): column quantity",
    );
    assert.equal(
      named("ER_NO_SUCH_TABLE", 1146, "Table 'louez.received_invoices' doesn't exist"),
      "ER_NO_SUCH_TABLE (1146): table louez.received_invoices",
    );
    assert.equal(
      named(
        "ER_NO_REFERENCED_ROW_2",
        1452,
        "Cannot add or update a child row: a foreign key constraint fails (`louez`.`payments`, CONSTRAINT `payments_reservation_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`))",
      ),
      "ER_NO_REFERENCED_ROW_2 (1452): constraint payments_reservation_fk",
    );
    // A code without a parser: the code alone.
    assert.equal(
      named("ER_PARSE_ERROR", 1064, "near 'FAKE_PARSE' at line 1"),
      "ER_PARSE_ERROR (1064)",
    );
    // As Drizzle throws it: the query's shape, the driver's error as cause.
    const sqlMessage = "Duplicate entry 'O'Brien-private-name-canary' for key 'customers.email'";
    const facts = sanitizeError(
      new Error("Failed query: insert into `customers` (`email`) values (?)\nparams: FAKE_PARAM", {
        cause: Object.assign(new Error(sqlMessage), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
          sqlMessage,
          sql: "insert into `customers` (`email`) values ('O''Brien-private-name-canary')",
        }),
      }),
    );
    assert.equal(
      facts.message,
      "Failed query: insert into [value] ([value]) values (?)\nparams: [redacted]",
    );
    assert.equal(facts.cause?.message, "ER_DUP_ENTRY (1062): key customers.email");
    assertNone(JSON.stringify(facts), ["Brien", "canary", "FAKE_PARAM"]);
  });

  test("a validation error keeps its issues' codes and static paths, never their messages", () => {
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
    assertNone(JSON.stringify(wrapped), ["0612345678"]);
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
    const facts = sanitizeError(
      Object.assign(new Error("boom"), { code: "jane@example.test", type: "a b" }),
    );
    assert.equal(facts.code, undefined);
    assert.equal(facts.type, undefined);
  });

  test("a thrown value that is no error gives its kind, or its text's shape", () => {
    assert.deepEqual(sanitizeError(`token=${BEARER}`), {
      name: "NonError",
      message: "token= [redacted]",
      frames: [],
    });
    const thrown = sanitizeError({ email: EMAIL, token: BEARER });
    assert.equal(thrown.message, "a thrown object");
    assertNone(JSON.stringify(thrown), [EMAIL, BEARER]);
  });

  test("a provider error is one sanitized line with its codes", () => {
    const error = Object.assign(new Error(`No such customer: ${EMAIL}`), {
      type: "StripeInvalidRequestError",
      statusCode: 404,
    });
    assert.equal(
      describeProviderError(error),
      "Error: No such customer: [value] (type=StripeInvalidRequestError, statusCode=404)",
    );
    assertNone(describeProviderError(new Error(`Authorization: Bearer ${BEARER}`)), [BEARER]);
  });
});

// What error tracking added to the list (PR #108), now read by shape.
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
      `Failing row contains (42, '${canaries.pgRow}', null).`,
      `SMS to ${canaries.phone} failed`,
      `digest ${canaries.hex} blob ${canaries.base64}`,
    ].join("\n");
    const clean = sanitizeText(text);
    assertNone(clean, Object.values(canaries));
    assert.equal(
      clean,
      [
        "[value]",
        "GET [path] failed",
        "Incorrect integer value: [value] for column [value] at row [value]",
        "Key (email)=([value]) already exists.",
        "Failing row contains ([value], [value], null).",
        "SMS to [value] failed",
        "digest [value] blob [value]",
      ].join("\n"),
    );
  });
});

describe("sanitizing in linear time", () => {
  const MB = 1_000_000;

  test("a megabyte of crafted text is sanitized in well under 50 ms", () => {
    const inputs = {
      letters: "x".repeat(MB),
      ats: "a@".repeat(MB / 2),
      dots: "a.".repeat(MB / 2),
      base64: "QmxvYkNhbmFyeQ".repeat(MB / 14),
      equals: "=".repeat(MB),
      pluses: "+".repeat(MB),
      slashes: "/".repeat(MB),
      slashedWords: "a/".repeat(MB / 2),
      paddedBase64: `${"QUJD".repeat(MB / 8)}${"=".repeat(MB / 2)}`,
      schemes: "a://".repeat(MB / 4),
      queries: "a?".repeat(MB / 2),
      quotes: "'".repeat(MB),
      apostrophes: "a'".repeat(MB / 2),
      backslashes: "\\".repeat(MB),
      keys: 'password="'.repeat(MB / 10),
      cookies: "cookie: ".repeat(MB / 8),
      lines: "a\n".repeat(MB / 2),
    };
    for (const [name, text] of Object.entries(inputs)) {
      const started = performance.now();
      sanitizeText(text);
      sanitizeError(Object.assign(new Error(text), { stack: `Error\n    at ${text}` }));
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 50, `${name}: ${elapsed.toFixed(1)} ms`);
    }
  });

  test("the scan is linear: 200 KB read whole, uncut, stays fast", () => {
    const size = 200_000;
    for (const text of [
      "x".repeat(size),
      "a@".repeat(size / 2),
      "a://".repeat(size / 4),
      "/".repeat(size),
      "+".repeat(size),
      "=".repeat(size),
      "'".repeat(size),
      "a'".repeat(size / 2),
      '"'.repeat(size),
      "password: ".repeat(size / 10),
      "token=".repeat(size / 6),
      "Bearer\n".repeat(size / 7),
    ]) {
      const started = performance.now();
      sanitizeText(text, size);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 250, `${JSON.stringify(text.slice(0, 12))}…: ${elapsed.toFixed(1)} ms`);
    }
  });
});
