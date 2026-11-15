import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildInput, commandWords, operationLookup, parseLine, type SourceReader } from "./args.js";
import type { Operation } from "./manifest.js";
import { UsageError } from "./usage-error.js";

const recordPayment: Operation = {
  id: "record_payment",
  group: "payments",
  action: "record",
  method: "POST",
  path: "/reservations/{reservationId}/payments",
  summary: "Record Payment",
  description: "",
  pathParams: [{ name: "reservationId", flag: "reservation-id", kind: "string", required: true }],
  query: [],
  body: {
    required: true,
    fields: [
      { name: "type", flag: "type", kind: "string", required: true, enum: ["rental", "deposit"] },
      { name: "amount", flag: "amount", kind: "string", required: true },
      { name: "notes", flag: "notes", kind: "string", nullable: true },
      { name: "latitude", flag: "latitude", kind: "number", nullable: true },
      { name: "quantity", flag: "quantity", kind: "integer" },
      { name: "isActive", flag: "is-active", kind: "boolean" },
      { name: "ids", flag: "ids", kind: "string", list: true },
      { name: "promotion", flag: "promotion", kind: "json" },
    ],
  },
  idempotent: true,
  confirmation: true,
};

const listProducts: Operation = {
  id: "products_list",
  group: "products",
  action: "list",
  method: "GET",
  path: "/products",
  summary: "List Products",
  description: "",
  pathParams: [],
  query: [
    { name: "status", flag: "status", kind: "string" },
    { name: "categoryIds", flag: "category-ids", kind: "string", list: true },
    { name: "limit", flag: "limit", kind: "integer" },
    { name: "includeTexts", flag: "include-texts", kind: "boolean" },
  ],
  body: null,
  idempotent: false,
  confirmation: false,
};

const noSources: SourceReader = async (spec) => {
  if (spec === "-" || spec.startsWith("@")) throw new Error("no source in this test");
  return spec;
};

const input = async (operation: Operation, argv: string[], read: SourceReader = noSources) =>
  buildInput(operation, parseLine(argv, operationLookup(operation)), read);

describe("the command line", () => {
  test("finds the command's words past the global flags", () => {
    const argv = [
      "--api-url",
      "http://127.0.0.1:1",
      "--insecure",
      "payments",
      "record",
      "r1",
      "--amount",
      "1",
    ];
    assert.deepEqual(
      commandWords(argv, 2).map((index) => argv[index]),
      ["payments", "record"],
    );
    // An operation's flag ends the search: the command comes first.
    assert.deepEqual(commandWords(["payments", "--amount", "1", "record"], 2), [0]);
  });

  test("takes path parameters as positional arguments, encoded", async () => {
    const { path } = await input(recordPayment, [
      "res 1?é",
      "--type",
      "rental",
      "--amount",
      "10.00",
    ]);
    assert.equal(path, "/reservations/res%201%3F%C3%A9/payments");
  });

  test("refuses a missing or an extra positional argument", async () => {
    await assert.rejects(
      input(recordPayment, ["--type", "rental", "--amount", "1"]),
      /Missing <reservationId>/,
    );
    await assert.rejects(
      input(recordPayment, ["r1", "r2", "--type", "rental", "--amount", "1"]),
      /Unexpected argument "r2"/,
    );
  });

  test("turns flags into body fields of their kind", async () => {
    const { body, query } = await input(recordPayment, [
      "r1",
      "--type=rental",
      "--amount",
      "-20.00",
      "--notes",
      "null",
      "--latitude",
      "48.85",
      "--quantity",
      "3",
      "--no-is-active",
      "--ids",
      "a",
      "--ids",
      "b",
      "--promotion",
      '{"percent":10}',
    ]);
    assert.deepEqual(body, {
      type: "rental",
      amount: "-20.00",
      notes: null,
      latitude: 48.85,
      quantity: 3,
      isActive: false,
      ids: ["a", "b"],
      promotion: { percent: 10 },
    });
    assert.equal(query.toString(), "");
  });

  test("turns a GET's flags into its query, arrays in bracket notation", async () => {
    const { query, body } = await input(listProducts, [
      "--status",
      "active",
      "--category-ids",
      '["c1","c2"]',
      "--limit=5",
      "--include-texts",
    ]);
    assert.equal(
      query.toString(),
      "status=active&categoryIds%5B0%5D=c1&categoryIds%5B1%5D=c2&limit=5&includeTexts=true",
    );
    assert.equal(body, undefined);
  });

  test("reads --json inline, from a file and from standard input, flags over it", async () => {
    const read: SourceReader = async (spec) => {
      if (spec === "-") return '{"type":"deposit","amount":"5.00"}';
      if (spec === "@body.json") return '{"type":"rental","amount":"7.00","notes":"from a file"}';
      return spec;
    };
    assert.deepEqual((await input(recordPayment, ["r1", "--json", "-"], read)).body, {
      type: "deposit",
      amount: "5.00",
    });
    assert.deepEqual(
      (await input(recordPayment, ["r1", "--json", "@body.json", "--amount", "8.00"], read)).body,
      {
        type: "rental",
        amount: "8.00",
        notes: "from a file",
      },
    );
    assert.deepEqual(
      (
        await input(listProducts, ["--json", '{"status":"draft","limit":2}'], read)
      ).query.toString(),
      "status=draft&limit=2",
    );
  });

  test("reads a known option where a value should be as a missing value, but a negative number as a value", async () => {
    for (const argv of [
      ["r1", "--type", "rental", "--amount", "--api-key", "lz_x"],
      ["r1", "--type", "rental", "--amount", "--no-is-active"],
      ["r1", "--type", "rental", "--amount", "--notes=x"],
      ["r1", "--type", "rental", "--amount", "-h"],
      ["r1", "--type", "rental", "--amount", "--"],
    ]) {
      await assert.rejects(input(recordPayment, argv), /--amount needs a value/, argv.join(" "));
    }
    const { body } = await input(recordPayment, [
      "r1",
      "--type",
      "rental",
      "--amount",
      "-20.00",
      "--notes",
      "--not-a-flag",
    ]);
    assert.deepEqual(body, { type: "rental", amount: "-20.00", notes: "--not-a-flag" });
  });

  test("refuses a path parameter that would be read as another segment, as is or encoded", async () => {
    for (const value of ["..", ".", "%2e%2E", ".%2e", "%2E", "a/b", "a\\b", "a%2Fb", "a%5cb"]) {
      await assert.rejects(
        input(recordPayment, [value, "--type", "rental", "--amount", "1"]),
        /may not be "\." or "\.\.", nor hold a slash or a backslash/,
        value,
      );
    }
    // A dot inside a value is a value.
    const { path } = await input(recordPayment, ["r.1..x", "--type", "rental", "--amount", "1"]);
    assert.equal(path, "/reservations/r.1..x/payments");
  });

  test("refuses what the operation does not take", async () => {
    const cases: Array<[Operation, string[], RegExp]> = [
      [recordPayment, ["r1", "--amount", "1"], /Missing --type/],
      [recordPayment, ["r1", "--type", "cash", "--amount", "1"], /one of rental, deposit/],
      [
        recordPayment,
        ["r1", "--type", "rental", "--amount", "1", "--quantity", "1.5"],
        /whole number/,
      ],
      [
        recordPayment,
        ["r1", "--type", "rental", "--amount", "1", "--latitude", "north"],
        /is a number/,
      ],
      [
        recordPayment,
        ["r1", "--type", "rental", "--amount", "1", "--promotion", "{"],
        /not valid JSON/,
      ],
      [recordPayment, ["r1", "--json", "[1]"], /JSON object/],
      [recordPayment, ["r1", "--colour", "red"], /Unknown flag --colour/],
      [recordPayment, ["r1", "--amount"], /--amount needs a value/],
      [recordPayment, ["r1", "--is-active=maybe"], /true or false/],
      [listProducts, ["-x"], /Unknown option -x/],
    ];
    for (const [operation, argv, message] of cases) {
      await assert.rejects(input(operation, argv), (error: unknown) => {
        assert.ok(error instanceof UsageError, `${argv.join(" ")} is a usage error`);
        assert.match(error.message, message);
        return true;
      });
    }
  });
});
