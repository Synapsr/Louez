import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A custom field the store flagged sensitive (here a passport number) never
// reaches an agent: the customer tools neither name it, ask for it, take it,
// return it nor search it. The assistants' directories forbid a tool that
// collects a government identifier. The store fills it in Louez.

const STORE = "store_mcp_customers";
const USER = "user_mcp_customers";
const PASSPORT = "def_mcp_passport";
const SIZE = "def_mcp_size";

describe(
  "MCP customer tools and sensitive fields (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let client: Client;

    before(async () => {
      database = await createTestDatabase("mcp_customers");
      louezDb = await import("@louez/db");
      const { registerCustomerTools } = await import("./customers");
      const { testRequestContext } = await import("../testing/request-context");
      const ctx = testRequestContext({
        storeId: STORE,
        userId: USER,
        storeName: "MCP customers",
        permissions: { customers: "write", reservations: "read" },
      });

      const server = new McpServer({ name: "louez", version: "0.0.0" });
      registerCustomerTools(server, ctx);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(clientTransport);

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "MCP customers",
        slug: "mcp-customers",
        settings: {
          reservationMode: "request",
          advanceNoticeMinutes: 0,
          currency: "EUR",
          country: "FR",
        },
      });
      await louezDb.db.insert(louezDb.customerFieldDefinitions).values([
        {
          id: PASSPORT,
          storeId: STORE,
          key: "passport_number",
          label: "Passport number",
          type: "text",
          section: "Identity",
          isRequired: true,
          isSensitive: true,
          isSearchable: true,
        },
        {
          id: SIZE,
          storeId: STORE,
          key: "shoe_size",
          label: "Shoe size",
          type: "text",
          section: "Gear",
          isSearchable: true,
        },
      ]);
    });

    after(async () => {
      await client?.close();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
      (result.content as { type: string; text?: string }[])
        .map((part) => part.text ?? "")
        .join("\n");

    const storedValue = async (customerId: string, definitionId: string) => {
      const [row] = await louezDb.db
        .select({ value: louezDb.customerFieldValues.value })
        .from(louezDb.customerFieldValues)
        .where(
          and(
            eq(louezDb.customerFieldValues.customerId, customerId),
            eq(louezDb.customerFieldValues.definitionId, definitionId),
          ),
        );
      return row?.value;
    };

    const customerId = async (email: string) => {
      const customer = await louezDb.db.query.customers.findFirst({
        where: eq(louezDb.customers.email, email),
        columns: { id: true },
      });
      assert.ok(customer, `${email} exists`);
      return customer.id;
    };

    test("create_customer is not blocked by a required sensitive field, and says Louez completes it", async () => {
      const created = await client.callTool({
        name: "create_customer",
        arguments: {
          email: "ana@example.com",
          firstName: "Ana",
          lastName: "Lima",
          customFields: [{ field: "Shoe size", value: "42" }],
        },
      });
      assert.notEqual(created.isError, true, text(created));
      const answer = text(created);
      assert.match(answer, /must be completed in Louez/);
      assert.ok(!answer.includes("Passport"), answer);

      const id = await customerId("ana@example.com");
      assert.equal(await storedValue(id, SIZE), "42");
      assert.equal(await storedValue(id, PASSPORT), undefined);
    });

    test("a sensitive field cannot be written, and errors never name it", async () => {
      const refused = await client.callTool({
        name: "create_customer",
        arguments: {
          email: "ben@example.com",
          firstName: "Ben",
          lastName: "Roy",
          customFields: [{ field: "Passport number", value: "X1234567" }],
        },
      });
      assert.equal(refused.isError, true);
      const error = text(refused);
      assert.match(error, /Unknown custom field/);
      assert.match(error, /Available fields: Shoe size\./);
      assert.equal(
        await louezDb.db.query.customers.findFirst({
          where: eq(louezDb.customers.email, "ben@example.com"),
        }),
        undefined,
        "nothing created",
      );

      const id = await customerId("ana@example.com");
      const update = await client.callTool({
        name: "update_customer",
        arguments: { customerId: id, customFields: [{ field: "passport_number", value: "X1" }] },
      });
      assert.equal(update.isError, true);
      assert.match(text(update), /Available fields: Shoe size\./);
      assert.equal(await storedValue(id, PASSPORT), undefined);
    });

    test("update_customer leaves a sensitive value the store filled in Louez as it is", async () => {
      const id = await customerId("ana@example.com");
      await louezDb.db.insert(louezDb.customerFieldValues).values({
        storeId: STORE,
        customerId: id,
        definitionId: PASSPORT,
        value: "X7654321",
        searchValue: "x7654321",
      });

      const updated = await client.callTool({
        name: "update_customer",
        arguments: { customerId: id, customFields: [{ field: "Shoe size", value: "EU43" }] },
      });
      assert.notEqual(updated.isError, true, text(updated));
      assert.equal(await storedValue(id, SIZE), "EU43");
      assert.equal(await storedValue(id, PASSPORT), "X7654321");
    });

    test("get_customer neither shows nor names a sensitive field", async () => {
      const id = await customerId("ana@example.com");
      const profile = text(
        await client.callTool({ name: "get_customer", arguments: { customerId: id } }),
      );
      assert.match(profile, /Shoe size\*\*: EU43/);
      assert.match(profile, /Other details are kept in Louez only/);
      assert.ok(!profile.includes("Passport"), profile);
      assert.ok(!profile.includes("X7654321"), profile);
    });

    test("list_customers never matches a sensitive field", async () => {
      const found = (result: Awaited<ReturnType<Client["callTool"]>>) =>
        text(result).includes("ana@example.com");
      assert.equal(
        found(await client.callTool({ name: "list_customers", arguments: { search: "X7654" } })),
        false,
        "list_customers",
      );
      assert.equal(
        found(await client.callTool({ name: "list_customers", arguments: { search: "EU4" } })),
        true,
        "a field the store did not flag is still searched",
      );
    });
  },
);
