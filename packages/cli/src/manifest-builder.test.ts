import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildManifest, fieldShape, kebabCase, type OpenApiDocument } from "./manifest-builder.js";

const idempotencyKey = { $ref: "#/components/parameters/IdempotencyKey" };
const confirmation = { $ref: "#/components/parameters/LouezConfirmation" };

/** A small document in the shape oRPC generates for the API. */
function fixture(): OpenApiDocument {
  return {
    info: { version: "9.9.9-test" },
    tags: [
      { name: "Reservations", description: "Bookings." },
      { name: "Payments", description: "Money recorded." },
      { name: "Products", description: "What the store rents." },
      { name: "Units", description: "Tracked items." },
      { name: "Seasonal pricing", description: "Season prices." },
      { name: "Unused", description: "No operation." },
    ],
    components: {
      parameters: {
        IdempotencyKey: { name: "Idempotency-Key", in: "header" },
        LouezConfirmation: { name: "Louez-Confirmation", in: "header" },
      },
    },
    paths: {
      "/reservations": {
        get: {
          operationId: "reservations_list",
          summary: "List Reservations",
          description: "Lists them.",
          tags: ["Reservations"],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["pending", "confirmed"],
                description: "Only this status.",
              },
            },
            {
              name: "categoryIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
            },
            { name: "limit", in: "query", schema: { type: "integer" } },
            {
              name: "includeTexts",
              in: "query",
              schema: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] },
            },
          ],
        },
      },
      "/reservations/{reservationId}/payments": {
        post: {
          operationId: "record_payment",
          summary: "Record Payment",
          description: "Records one.",
          tags: ["Payments"],
          parameters: [
            { name: "reservationId", in: "path", required: true, schema: { type: "string" } },
            idempotencyKey,
            confirmation,
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "string", description: "Amount" },
                    notes: { anyOf: [{ type: "string" }, { type: "null" }] },
                    latitude: { anyOf: [{ type: "number" }, { type: "null" }] },
                    items: { type: "array", items: { type: "object" } },
                  },
                  required: ["amount"],
                },
              },
            },
          },
        },
      },
      "/products": {
        get: { operationId: "products_list", summary: "List Products", tags: ["Products"] },
      },
      "/products/{id}/units": {
        get: {
          operationId: "products_list_units",
          summary: "List Units",
          tags: ["Units"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        },
      },
      "/products/units/{unitId}/history": {
        get: {
          operationId: "products_get_unit_history",
          summary: "Unit History",
          tags: ["Units"],
          parameters: [{ name: "unitId", in: "path", required: true, schema: { type: "string" } }],
        },
      },
      "/products/{productId}/seasonal-pricings/{id}": {
        delete: {
          operationId: "products_delete_seasonal_pricing",
          summary: "Delete Seasonal Pricing",
          tags: ["Seasonal pricing"],
          parameters: [
            { name: "productId", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            idempotencyKey,
          ],
        },
      },
      // Two operations whose actions meet: each keeps its whole id.
      "/payments/a": {
        post: { operationId: "payments_sync", summary: "Sync A", tags: ["Payments"] },
      },
      "/payments/b": {
        post: { operationId: "sync_payments", summary: "Sync B", tags: ["Payments"] },
      },
      // Nothing left once the group's words are dropped.
      "/reservations/all": {
        get: { operationId: "reservations", summary: "All", tags: ["Reservations"] },
      },
    },
  };
}

const byId = (id: string) => {
  const operation = buildManifest(fixture()).operations.find((candidate) => candidate.id === id);
  assert.ok(operation, `${id} is in the manifest`);
  return operation;
};

describe("buildManifest", () => {
  test("names each operation after its tag and its operationId", () => {
    const commands = buildManifest(fixture()).operations.map(
      (operation) => `${operation.group} ${operation.action}`,
    );
    assert.deepEqual(commands, [
      "reservations list",
      // The words of its own group go, singular or plural.
      "payments record",
      "products list",
      // The leading words that name a group go, then the group's own.
      "units list",
      "units get-history",
      "seasonal-pricing delete",
      // Two operations with one action take their whole ids.
      "payments payments-sync",
      "payments sync-payments",
      // Nothing left: the whole id.
      "reservations reservations",
    ]);
  });

  test("lists the groups operations use, in the document's order, with their descriptions", () => {
    assert.deepEqual(buildManifest(fixture()).groups, [
      { name: "reservations", title: "Reservations", description: "Bookings." },
      { name: "payments", title: "Payments", description: "Money recorded." },
      { name: "products", title: "Products", description: "What the store rents." },
      { name: "units", title: "Units", description: "Tracked items." },
      { name: "seasonal-pricing", title: "Seasonal pricing", description: "Season prices." },
    ]);
    assert.equal(buildManifest(fixture()).apiVersion, "9.9.9-test");
  });

  test("takes path parameters in the path's order, as positional arguments", () => {
    assert.deepEqual(
      byId("products_delete_seasonal_pricing").pathParams.map((param) => param.name),
      ["productId", "id"],
    );
  });

  test("turns query parameters and body fields into kebab-case flags of their kind", () => {
    const list = byId("reservations_list");
    assert.deepEqual(list.query, [
      {
        name: "status",
        flag: "status",
        kind: "string",
        enum: ["pending", "confirmed"],
        description: "Only this status.",
      },
      { name: "categoryIds", flag: "category-ids", kind: "string", list: true },
      { name: "limit", flag: "limit", kind: "integer" },
      { name: "includeTexts", flag: "include-texts", kind: "boolean" },
    ]);
    assert.equal(list.body, null);

    const record = byId("record_payment");
    assert.deepEqual(record.body, {
      required: true,
      fields: [
        { name: "amount", flag: "amount", kind: "string", required: true, description: "Amount" },
        { name: "notes", flag: "notes", kind: "string", nullable: true },
        { name: "latitude", flag: "latitude", kind: "number", nullable: true },
        { name: "items", flag: "items", kind: "json" },
      ],
    });
  });

  test("records the idempotency and confirmation headers an operation documents", () => {
    assert.deepEqual(
      [byId("record_payment").idempotent, byId("record_payment").confirmation],
      [true, true],
    );
    assert.deepEqual(
      [
        byId("products_delete_seasonal_pricing").idempotent,
        byId("products_delete_seasonal_pricing").confirmation,
      ],
      [true, false],
    );
    assert.deepEqual(
      [byId("reservations_list").idempotent, byId("reservations_list").confirmation],
      [false, false],
    );
  });

  test("records an Idempotency-Key the spec requires, and only where it does", () => {
    const document = fixture();
    document.components!.parameters!.IdempotencyKeyRequired = {
      name: "Idempotency-Key",
      in: "header",
      required: true,
    };
    document.paths["/reservations"]!.post = {
      operationId: "reservations_create",
      summary: "Create Reservation",
      tags: ["Reservations"],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKeyRequired" }],
    };
    const operations = buildManifest(document).operations;
    const create = operations.find((operation) => operation.id === "reservations_create");
    assert.equal(create?.idempotent, true);
    assert.equal(create?.idempotencyRequired, true);
    const others = operations.filter((operation) => operation.id !== "reservations_create");
    assert.ok(others.every((operation) => !("idempotencyRequired" in operation)));
  });

  test("refuses a field whose flag the CLI keeps for itself", () => {
    const document = fixture();
    document.paths["/reservations"]!.get!.parameters!.push({
      name: "apiKey",
      in: "query",
      schema: { type: "string" },
    });
    assert.throws(() => buildManifest(document), /--api-key, which the CLI keeps/);
  });

  test("refuses a tag that would be a built-in command", () => {
    const document = fixture();
    document.paths["/reservations"]!.get!.tags = ["Auth"];
    assert.throws(() => buildManifest(document), /built-in command/);
  });
});

describe("kebabCase and fieldShape", () => {
  test("kebab-cases names", () => {
    assert.equal(kebabCase("categoryIds"), "category-ids");
    assert.equal(kebabCase("Online store"), "online-store");
    assert.equal(kebabCase("record_payment"), "record-payment");
    assert.equal(kebabCase("contentBase64"), "content-base64");
  });

  test("reads a union of a number and a string as a string, and of objects as JSON", () => {
    assert.deepEqual(fieldShape({ anyOf: [{ type: "integer" }, { type: "string" }] }), {
      kind: "string",
    });
    assert.deepEqual(fieldShape({ anyOf: [{ type: "object" }, { type: "null" }] }), {
      kind: "json",
      nullable: true,
    });
    assert.deepEqual(fieldShape({ anyOf: [{ type: "string" }, { const: "" }] }), {
      kind: "string",
    });
  });
});
