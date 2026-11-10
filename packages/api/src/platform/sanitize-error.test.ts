import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

/** The repository's root on this machine: frames are kept for its own files only. */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

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
    // A number is a code only when it is a known MySQL error number.
    for (const code of [33612345678, 612345678, 7, -1, 1.5, Number.NaN]) {
      assert.equal(sanitizeCode(code), "[code]");
    }
    const numbered = sanitizeError(
      Object.assign(new Error("x"), { code: 33612345678, type: 33612345678, errno: 1062 }),
    );
    assert.equal(numbered.code, "[code]");
    assert.equal(numbered.type, "[code]");
    assertNone(numbered, ["33612345678"]);
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
  test("a frame keeps its place in the repository only, when this machine holds its file", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      `    at listInbox (${ROOT}/packages/api/src/services/inbox.ts:1723:9)`,
      `    at ${ROOT}/packages/api/src/platform/errors.ts:9:9`,
      `    at render (file://${ROOT}/apps/web/instrumentation.ts:4:2)`,
      "    at async Promise.all (index 12)",
      "    at Object.<anonymous> (node:internal/modules/cjs/loader:1638:15)",
      // Shaped as the repository's, but not a file of this machine.
      "    at listInbox (/app/packages/api/src/services/inbox.ts:1:1)",
      "    at load (/app/packages/api/src/attacker_chosen_name.ts:1:2)",
      `    at load (${ROOT}/packages/api/src/attacker_chosen_name.ts:1:2)`,
      // Third-party code, wherever it stands.
      "    at load (/app/node_modules/provider/packages/api/src/services/inbox.ts:1:2)",
      `    at load (${ROOT}/node_modules/provider/packages/api/src/services/inbox.ts:1:2)`,
      `    at load (${ROOT}/packages/api/node_modules/zod/index.js:1:1)`,
      // Outside the repository, or out of it through `..`.
      "    at fn (/home/jane/notes.js:1:1)",
      `    at fn (${ROOT}/packages/api/src/../../../../etc/hosts:1:1)`,
      "    at handler (https://app.louez.test/x?code=FAKE_FRAME:0:1)",
      `at missing (${ROOT}/packages/api/src/services/inbox.ts:1:1)`,
    ].join("\n");
    assert.deepEqual(sanitizeError(error).frames, [
      "packages/api/src/services/inbox.ts:1723:9",
      "packages/api/src/platform/errors.ts:9:9",
      "apps/web/instrumentation.ts:4:2",
    ]);
    assert.equal(sanitizeError(error, { frames: 1 }).frames.length, 1);
  });

  test("a message that imitates a frame is never read as one", () => {
    const message = `boom\n    at PrivateCustomer (/app/packages/api/src/${CANARY}.ts:1:2)\n    at x (${ROOT}/packages/api/src/attacker_chosen_name.ts:1:2)`;
    for (const error of [
      new Error(message),
      new TypeError(message),
      new ORPCError("BAD_REQUEST", { message }),
    ]) {
      const facts = sanitizeError(error);
      assertNone(facts, ["PrivateCustomer", CANARY, "attacker_chosen_name"]);
      assert.ok(facts.frames.length > 0);
    }
    // The stack is written first, the message shortened after: its frames still say nothing.
    const shortened = new Error(message);
    void shortened.stack;
    shortened.message = "boom";
    const facts = sanitizeError(shortened);
    assertNone(facts, ["PrivateCustomer", CANARY, "attacker_chosen_name"]);
    assert.ok(facts.frames.every((frame) => frame.startsWith("packages/api/src/platform/")));
  });
});

describe("sanitizing errors: structures", () => {
  test("a MySQL error keeps its code, number and the schema object Louez's schema names", () => {
    const sqlError = (code: string, errno: number, sqlMessage: string) =>
      sanitizeError(Object.assign(new Error(sqlMessage), { code, errno, sqlMessage }));
    const duplicate = sqlError(
      "ER_DUP_ENTRY",
      1062,
      `Duplicate entry 'O'Brien-${CANARY}' for key 'customer_field_definitions.customer_field_definitions_store_key_unique'`,
    );
    assert.equal(duplicate.code, "ER_DUP_ENTRY");
    assert.equal(duplicate.errno, 1062);
    assert.deepEqual(duplicate.schemaObject, {
      kind: "key",
      name: "customer_field_definitions_store_key_unique",
    });
    assertNone(duplicate, [CANARY, "Brien"]);
    assert.deepEqual(
      sqlError("ER_DUP_ENTRY", 1062, "Duplicate entry '1' for key 'customers.PRIMARY'")
        .schemaObject,
      { kind: "key", name: "PRIMARY" },
    );
    // A value that imitates the message's end: the name is read at the end only.
    const imitation = sqlError(
      "ER_DUP_ENTRY",
      1062,
      `Duplicate entry 'v' for key '${CANARY}' x' for key 'customers.${CANARY}'`,
    );
    assert.deepEqual(imitation.schemaObject, { kind: "key", name: "[schema object]" });
    assertNone(imitation, [CANARY]);
    // A name Louez's schema does not write, however it is shaped: a placeholder.
    for (const [code, errno, sqlMessage] of [
      ["ER_BAD_NULL_ERROR", 1048, `Column '${PRIVATE}' cannot be null`],
      ["ER_BAD_NULL_ERROR", 1048, "Column 'private_customer' cannot be null"],
      ["ER_NO_SUCH_TABLE", 1146, "Table 'louez.private_customer_canary' doesn't exist"],
      ["ER_DUP_ENTRY", 1062, "Duplicate entry 'x' for key 'customers.private_customer_canary'"],
    ] as const) {
      const facts = sqlError(code, errno, sqlMessage);
      assert.equal(facts.schemaObject?.name, "[schema object]");
      assertNone(facts, [PRIVATE, "private_customer"]);
    }
    assert.deepEqual(
      sqlError("ER_NO_SUCH_TABLE", 1146, "Table 'louez_test.received_invoices' doesn't exist")
        .schemaObject,
      { kind: "table", name: "received_invoices" },
    );
    assert.deepEqual(
      sqlError("ER_DATA_TOO_LONG", 1406, "Data too long for column 'phone' at row 1").schemaObject,
      { kind: "column", name: "phone" },
    );
    assert.deepEqual(
      sqlError(
        "ER_NO_REFERENCED_ROW_2",
        1452,
        "Cannot add or update a child row: a foreign key constraint fails (`louez`.`api_agent_grant_stores`, CONSTRAINT `api_agent_grant_stores_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`))",
      ).schemaObject,
      { kind: "constraint", name: "api_agent_grant_stores_store_id_stores_id_fk" },
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

  test("lists are read by index, never through their own methods, and the result is plain JSON", () => {
    class Hostile extends Array<unknown> {
      override slice(): never {
        throw new Error("FAKE_SLICE_CANARY");
      }
      override map(): never {
        throw new Error("FAKE_MAP_CANARY");
      }
      toJSON(): never {
        throw new Error("FAKE_TOJSON_CANARY");
      }
    }
    const path = Hostile.from(["customer", CANARY, 0]) as Hostile;
    const issue = {
      code: "invalid_type",
      path,
      toJSON() {
        throw new Error("FAKE_TOJSON_CANARY");
      },
    };
    const issues = Hostile.from([issue, issue]) as Hostile;
    const huge = Object.assign([issue], { length: 1e9 });
    const lyingLength = new Proxy([issue], {
      get(target, key) {
        if (key === "length") throw new Error("FAKE_LENGTH_CANARY");
        return Reflect.get(target, key);
      },
    });
    for (const list of [issues, huge, lyingLength, Object.assign([issue], { length: "2" })]) {
      const facts = sanitizeError(
        Object.assign(new Error(CANARY), {
          issues: list,
          code: BigInt(10),
          data: { code: { toJSON: () => CANARY } },
          errno: { valueOf: () => 1 },
          cause: Object.assign(new Error(CANARY), { issues: list }),
        }),
      );
      const json = JSON.stringify(facts);
      assertNone(json, [CANARY, "FAKE_SLICE_CANARY", "FAKE_MAP_CANARY", "FAKE_TOJSON_CANARY"]);
      assert.deepEqual(JSON.parse(json), facts);
    }
    const first = sanitizeError(Object.assign(new Error("x"), { issues }));
    assert.deepEqual(first.issues, [
      { code: "invalid_type", path: "customer.[key].0" },
      { code: "invalid_type", path: "customer.[key].0" },
    ]);
    assert.equal(sanitizeError(Object.assign(new Error("x"), { issues: huge })).issues?.length, 20);
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
