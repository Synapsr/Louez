import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import { ORPCError } from "@orpc/server";
import { z } from "zod";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  mock.module(name, { namedExports: require(name) });
}

const { ApiServiceError } = await import("../services/errors");
const { productErrors } = await import("../contracts/products");
const { variantErrors } = await import("../contracts/product-variants");
const { platformErrors } = await import("./errors");
const { KNOWN_CODES, describeProviderError, logProviderError, sanitizeCode, sanitizeError } =
  await import("./sanitize-error");

// Fake values only: what an error may carry, and must not reach a log.
const PRIVATE = "Private Customer";
const CANARY = "qzmxvbnlkjhgfdsapoiu";

/** No canary survives in `value` once written as a log or a report would write it. */
function assertNone(value: unknown, canaries: readonly string[]) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const canary of canaries) {
    for (const part of [canary, ...canary.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 6)]) {
      assert.ok(
        !text.toLowerCase().includes(part.toLowerCase()),
        `${JSON.stringify(part)} survived in ${text}`,
      );
    }
  }
}

describe("sanitizing errors: codes and code locations, no text", () => {
  test("no message is kept, whoever wrote it", () => {
    for (const message of [
      `Rejected value ${CANARY}`,
      `pass: ${CANARY}`,
      `session: ${CANARY}`,
      `client_secret: ${CANARY}`,
      `https://example.test/callback#code=first,${CANARY}`,
      `https://example.test/callback#code=first;${CANARY}`,
      `{"cookie":"session=${CANARY}"}`,
      `Duplicate entry 'O'Brien-${CANARY}' for key 'customers.email'`,
    ]) {
      for (const error of [
        new Error(message),
        new TypeError(message),
        Object.assign(new Error(message), { type: "StripeInvalidRequestError" }),
        new ORPCError("BAD_REQUEST", { message }),
        new Error("outer", { cause: new Error(message) }),
      ]) {
        const facts = sanitizeError(error);
        assert.equal(facts.message, "[message withheld]");
        assertNone(facts, [CANARY, "Brien"]);
        assertNone(describeProviderError(error), [CANARY, "Brien"]);
      }
    }
  });

  test("Louez's own errors give their registered code and key, never the values in their message", () => {
    const inUse = sanitizeError(variantErrors.inUse([{ id: "prod_1", name: PRIVATE }], 1));
    assert.equal(inUse.message, "[message withheld]");
    assert.equal(inUse.apiCode, "VARIANT_IN_USE");
    assert.equal(inUse.code, "CONFLICT");
    assertNone(inUse, [PRIVATE]);

    const notFound = sanitizeError(productErrors.notFound(PRIVATE));
    assert.equal(notFound.apiCode, "PRODUCT_NOT_FOUND");
    assert.equal(notFound.i18nKey, "errors.productNotFound");
    assertNone(notFound, [PRIVATE]);

    assert.equal(sanitizeError(platformErrors.noStore()).apiCode, "NO_STORE_ACCESS");
    assert.match(
      describeProviderError(productErrors.notFound(PRIVATE)),
      /^\w+: \[message withheld\] \(code=NOT_FOUND, apiCode=PRODUCT_NOT_FOUND\)$/,
    );

    // An older service: its registered translation key.
    const service = sanitizeError(new ApiServiceError("NOT_FOUND", "errors.productNotFound"));
    assert.equal(service.i18nKey, "errors.productNotFound");
    assert.equal(service.code, "NOT_FOUND");
    assert.equal(service.message, "[message withheld]");
  });

  test("a code or key an error claims, outside Louez's registry, is a placeholder", () => {
    const forged = new ORPCError("BAD_REQUEST", {
      message: PRIVATE,
      data: { code: "PRIVATE_CUSTOMER", i18nKey: "errors.privateCustomer" },
    });
    const facts = sanitizeError(forged);
    assert.equal(facts.apiCode, "[code]");
    assert.equal(facts.i18nKey, "[code]");
    assertNone(facts, [PRIVATE, "privatecustomer", "PRIVATE_CUSTOMER"]);
    // A provider's error carrying the old marker gains nothing from it.
    const marked = Object.assign(new Error(`${PRIVATE} failed`), {
      [Symbol.for("louez.templatedError")]: true,
      data: { code: "PRIVATE_CUSTOMER" },
    });
    const markedFacts = sanitizeError(marked);
    assert.equal(markedFacts.message, "[message withheld]");
    assert.equal(markedFacts.apiCode, "[code]");
    assertNone(markedFacts, [PRIVATE, "PRIVATE_CUSTOMER"]);
    assertNone(describeProviderError(marked), [PRIVATE, "PRIVATE_CUSTOMER"]);
  });

  test("a name, a code or a type outside the known ones is a placeholder", () => {
    const facts = sanitizeError(
      Object.assign(new Error("CANARY_PRIVATE"), {
        name: "CANARY_PRIVATE",
        code: "CANARY_PRIVATE",
        type: "CANARY_PRIVATE",
        errno: -2,
        statusCode: 500,
      }),
    );
    assert.equal(facts.name, "[name]");
    assert.equal(facts.code, "[code]");
    assert.equal(facts.type, "[code]");
    assert.equal(facts.errno, -2);
    assert.equal(facts.statusCode, 500);
    assertNone(facts, ["CANARY_PRIVATE"]);
  });

  test("a code is kept only from a known vocabulary, made of codes only", () => {
    for (const code of [
      "ER_DUP_ENTRY",
      "ENOENT",
      "ERR_INVALID_ARG_TYPE",
      "UND_ERR_SOCKET",
      "FORBIDDEN",
      "INTERNAL_SERVER_ERROR",
      "card_declined",
      "card_error",
      "StripeCardError",
    ]) {
      assert.equal(sanitizeCode(code), code);
    }
    assert.equal(sanitizeCode(1062), "1062");
    for (const code of ["missing", "fraudulent", "CANARY_PRIVATE", "jane@example.test", 1.5]) {
      assert.equal(sanitizeCode(code), "[code]");
    }
    for (const code of ["", null, undefined, {}]) assert.equal(sanitizeCode(code), undefined);
    // Every entry is shaped as a code: capitals, lower snake case with an underscore, a Stripe class.
    for (const code of KNOWN_CODES) {
      assert.match(
        code,
        /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+|Stripe[A-Za-z]+Error)$/,
      );
    }
  });
});

describe("sanitizing errors: frames", () => {
  test("a frame keeps its place in the repository only, without its function", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at listInbox (/app/packages/api/src/services/inbox.ts:1723:9)",
      "    at async Promise.all (index 12)",
      "    at Object.<anonymous> (node:internal/modules/cjs/loader:1638:15)",
      "    at query (file:///app/node_modules/.pnpm/mysql2@3.14.0/node_modules/mysql2/lib/conn.js:1:1)",
      "    at render (/Users/jane/Louez/apps/web/.next/server/app/(dashboard)/page.js:4:2)",
      "    at /Users/jane/Louez/packages/db/src/index.ts:9:9",
      "    at fn (/home/jane/notes.js:1:1)",
      "    at handler (https://app.louez.test/x?code=FAKE_FRAME:0:1)",
      "    at load (/app/packages/api/node_modules/zod/index.js:1:1)",
      "at missing (/app/packages/api/src/x.ts:1:1)",
    ].join("\n");
    assert.deepEqual(sanitizeError(error).frames, [
      "packages/api/src/services/inbox.ts:1723:9",
      "apps/web/.next/server/app/(dashboard)/page.js:4:2",
      "packages/db/src/index.ts:9:9",
    ]);
    assert.equal(sanitizeError(error, { frames: 1 }).frames.length, 1);
  });

  test("a message that imitates a frame is never read as one", () => {
    const message = `boom\n    at PrivateCustomer (/app/packages/api/src/${CANARY}.ts:1:2)`;
    for (const error of [
      new Error(message),
      new TypeError(message),
      new ORPCError("BAD_REQUEST", { message }),
    ]) {
      const facts = sanitizeError(error);
      assertNone(facts, ["PrivateCustomer", CANARY]);
      assert.ok(facts.frames.every((frame) => frame.startsWith("packages/api/src/platform/")));
    }
    // A stack whose start is not the message gives no frame at all.
    const changed = new Error(message);
    changed.message = "boom";
    assertNone(sanitizeError(changed), ["PrivateCustomer", CANARY]);
  });
});

describe("sanitizing errors: structures", () => {
  test("a MySQL error keeps its code, number and the schema object named at its place", () => {
    const sqlError = (code: string, errno: number, sqlMessage: string) =>
      sanitizeError(Object.assign(new Error(sqlMessage), { code, errno, sqlMessage }));
    const duplicate = sqlError(
      "ER_DUP_ENTRY",
      1062,
      `Duplicate entry 'O'Brien-${CANARY}' for key 'customers.customers_email_unique'`,
    );
    assert.equal(duplicate.code, "ER_DUP_ENTRY");
    assert.equal(duplicate.errno, 1062);
    assert.deepEqual(duplicate.schemaObject, {
      kind: "key",
      name: "customers.customers_email_unique",
    });
    assertNone(duplicate, [CANARY, "Brien"]);
    // A value that imitates the message's end: the name is read at the end only.
    const imitation = sqlError(
      "ER_DUP_ENTRY",
      1062,
      `Duplicate entry 'v' for key '${CANARY}' x' for key 'customers.email'`,
    );
    assert.deepEqual(imitation.schemaObject, { kind: "key", name: "customers.email" });
    assertNone(imitation, [CANARY]);
    // A name not shaped as Louez's: none.
    assert.equal(
      sqlError("ER_BAD_NULL_ERROR", 1048, `Column '${PRIVATE}' cannot be null`).schemaObject,
      undefined,
    );
    assert.deepEqual(
      sqlError("ER_NO_SUCH_TABLE", 1146, "Table 'louez.received_invoices' doesn't exist")
        .schemaObject,
      { kind: "table", name: "louez.received_invoices" },
    );
    assert.deepEqual(
      sqlError(
        "ER_NO_REFERENCED_ROW_2",
        1452,
        "Cannot add or update a child row: a foreign key constraint fails (`louez`.`payments`, CONSTRAINT `payments_reservation_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`))",
      ).schemaObject,
      { kind: "constraint", name: "payments_reservation_fk" },
    );
    // As Drizzle throws it: no query, no parameter; the driver's facts as cause.
    const facts = sanitizeError(
      new Error(`Failed query: insert into \`customers\` values ('${CANARY}')\nparams: ${CANARY}`, {
        cause: Object.assign(new Error("x"), { code: "ER_DUP_ENTRY", errno: 1062 }),
      }),
    );
    assert.equal(facts.message, "[message withheld]");
    assert.equal(facts.cause?.code, "ER_DUP_ENTRY");
    assertNone(facts, [CANARY]);
  });

  test("a validation error keeps its issues' Zod codes and static paths", () => {
    const parsed = z
      .object({
        customer: z.object({
          phone: z.string().regex(/^\+33/, { message: `${CANARY} is wrong` }),
        }),
        attributes: z.record(z.string(), z.number()),
      })
      .safeParse({ customer: { phone: "0612345678" }, attributes: { sk_test_FakeKey123: "x" } });
    assert.ok(!parsed.success);
    const facts = sanitizeError(parsed.error);
    assert.deepEqual(facts.issues, [
      { code: "invalid_format", path: "customer.phone" },
      { code: "invalid_type", path: "attributes.[key]" },
    ]);
    assertNone(facts, [CANARY, "0612345678", "sk_test_FakeKey123"]);
    // oRPC wraps it: the cause carries the issues.
    assert.deepEqual(
      sanitizeError(new Error("Input validation failed", { cause: parsed.error })).cause?.issues,
      facts.issues,
    );
    // An issue code outside Zod's: a placeholder.
    const forged = sanitizeError(
      Object.assign(new Error("x"), { issues: [{ code: "privatecustomer", path: [] }] }),
    );
    assert.deepEqual(forged.issues, [{ code: "[code]", path: "" }]);
    assert.deepEqual(sanitizeError({ issues: [{ code: "privatecustomer", path: [] }] }), {
      name: "NonError",
      message: "a thrown object",
      frames: [],
    });
  });
});

describe("sanitizing errors: never a throw", () => {
  test("what is thrown that is no error gives its kind by typeof only", () => {
    const tagged = { [Symbol.toStringTag]: "privatecustomer" };
    const cases: Array<[unknown, string]> = [
      [`${CANARY}`, "string"],
      [42, "number"],
      [true, "boolean"],
      [tagged, "object"],
      [[CANARY], "array"],
      [null, "null"],
      [undefined, "undefined"],
      [Symbol(CANARY), "symbol"],
      [BigInt(10), "bigint"],
      [() => CANARY, "function"],
    ];
    for (const [value, kind] of cases) {
      const facts = sanitizeError(value);
      assert.equal(facts.message, `a thrown ${kind}`);
      assertNone(facts, [CANARY, "privatecustomer"]);
    }
  });

  test("an error that throws, or holds what cannot be read, never makes it throw", () => {
    const throwingMessage = new Error("x");
    Object.defineProperty(throwingMessage, "message", {
      get() {
        throw new Error("FAKE_GETTER_CANARY");
      },
    });
    const throwingEverything = new Error("x");
    for (const key of ["name", "stack", "code", "type", "statusCode", "cause", "issues", "data"]) {
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
    ]) {
      const facts = sanitizeError(error);
      assert.equal(typeof facts.name, "string");
      assert.equal(typeof facts.message, "string");
      assert.ok(Array.isArray(facts.frames));
      assertNone(facts, [
        "FAKE_GETTER_CANARY",
        "FAKE_TOSTRING_CANARY",
        "FAKE_PROXY_CANARY",
        "FAKE_SYMBOL",
      ]);
      assert.doesNotThrow(() => describeProviderError(error));
    }
    assert.equal(sanitizeError(numberStack).name, "[name]");
    assert.deepEqual(sanitizeError(numberStack).frames, []);
    assert.equal(sanitizeError(cyclic).cause?.message, "[cause cycle]");
    let depth = 0;
    for (let facts = sanitizeError(deep); facts.cause; facts = facts.cause) depth += 1;
    assert.equal(depth, 3);
  });

  test("a provider's log line names its class and codes only", () => {
    const error = Object.assign(new Error(`No such customer: ${CANARY}`), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
    });
    assert.equal(
      describeProviderError(error),
      "Error: [message withheld] (type=StripeInvalidRequestError, code=resource_missing, statusCode=404)",
    );
    const logged = mock.method(console, "error", () => {});
    try {
      logProviderError("Stripe failed", error);
      assertNone(String(logged.mock.calls[0]?.arguments[0]), [CANARY]);
    } finally {
      logged.mock.restore();
    }
  });

  test("a megabyte of crafted text in an error is read in well under 50 ms", () => {
    const MB = 1_000_000;
    for (const text of [
      "x".repeat(MB),
      "+".repeat(MB),
      "/".repeat(MB),
      "=".repeat(MB),
      "'".repeat(MB),
    ]) {
      const started = performance.now();
      sanitizeError(
        Object.assign(new Error(text), {
          stack: `Error: ${text}\n    at ${text}:1:1\n${"    at x (/app/packages/a/b.ts:1:1)\n".repeat(1000)}`,
          sqlMessage: text,
          code: "ER_DUP_ENTRY",
        }),
      );
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 50, `${text.charAt(0)}: ${elapsed.toFixed(1)} ms`);
    }
  });
});
