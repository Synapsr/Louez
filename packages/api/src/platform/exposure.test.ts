import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
// The app's router reaches @louez/validations too.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}
// The app's router loads @louez/auth, which reads the database URL. Nothing connects.
process.env.DATABASE_URL ??= "mysql://unused:unused@127.0.0.1:1/unused";

// The exposure registry: what OpenAPI and MCP may serve, and the rules a
// listed procedure must follow.

describe("exposure registry", () => {
  let exposure: typeof import("./exposure");
  let procedures: typeof import("./procedures");
  let testing: typeof import("./testing");
  let zod: typeof import("zod");

  before(async () => {
    exposure = await import("./exposure");
    procedures = await import("./procedures");
    testing = await import("./testing");
    zod = await import("zod");
  });

  const mcp = (name: string) => ({
    name,
    description: "A test tool.",
    bundle: "catalog" as const,
  });

  /** A procedure that follows every rule, then one change at a time. */
  function valid(name = "test_valid") {
    const { z } = zod;
    return procedures.storeProcedure
      .meta({
        capability: "test.valid",
        scope: { domain: "categories", level: "read" },
        mcp: mcp(name),
      })
      .input(z.object({ id: z.string() }))
      .output(z.object({ id: z.string() }))
      .handler(async ({ input }) => input);
  }

  function rejects(router: Record<string, unknown>, paths: string[], reason: RegExp) {
    assert.throws(
      () => exposure.createExposure(router as never, paths),
      (error: Error) => {
        assert.match(error.message, reason);
        return true;
      },
    );
  }

  test("the app's registry is valid against the app's router", async () => {
    const { appRouter } = await import("../router");
    const served = exposure.createExposure(appRouter);
    assert.equal(served.procedures.length, exposure.EXPOSED_PROCEDURES.length);
  });

  test("every migrated capability is exposed, and every exposed procedure is in the inventory", async () => {
    const { appRouter } = await import("../router");
    const { capabilities } = await import("./inventory");
    const served = exposure.createExposure(appRouter);
    const exposedCapabilities = new Set(served.procedures.map(({ meta }) => meta.capability));

    const known = new Set<string>(capabilities.map((capability) => capability.id));
    const unknown = served.procedures
      .filter(({ meta }) => !meta.capability || !known.has(meta.capability))
      .map(({ path, meta }) => `${path}: ${meta.capability ?? "no capability"}`);
    assert.deepEqual(unknown, [], "Exposed procedures whose capability is not in the inventory");

    const notExposed = capabilities
      .filter((capability) => "migrated" in capability && capability.migrated)
      .map((capability) => capability.id)
      .filter((id) => !exposedCapabilities.has(id));
    assert.deepEqual(notExposed, [], "Migrated capabilities no exposed procedure serves");
  });

  test("serves only the listed procedures, at their paths", () => {
    const router = testing.createFixtureRouter();
    const served = exposure.createExposure(router, ["fixture.notes.list"]);

    assert.deepEqual(
      served.procedures.map(({ path, meta }) => [path, meta.mcp.name]),
      [["fixture.notes.list", "fixture_notes_list"]],
    );
    const servedRouter = served.router as { fixture: { notes: Record<string, unknown> } };
    assert.deepEqual(Object.keys(servedRouter.fixture.notes), ["list"]);
    assert.equal(served.procedures[0].inputJsonSchema.type, "object");

    assert.deepEqual(exposure.createExposure(router, []).procedures, []);
  });

  test("refuses a path with no procedure", () => {
    const router = testing.createFixtureRouter();
    rejects(router, ["fixture.notes.missing"], /fixture\.notes\.missing: no procedure/);
    rejects(router, ["fixture.notes"], /fixture\.notes: no procedure/);
  });

  test("refuses a procedure without scope, input or output schema", () => {
    const { z } = zod;
    const noScope = procedures.storeProcedure
      .meta({ capability: "test.noScope", mcp: mcp("test_no_scope") })
      .input(z.object({}))
      .output(z.object({}))
      .handler(async () => ({}));
    rejects({ a: noScope }, ["a"], /a: no meta\.scope/);

    const noInput = procedures.storeProcedure
      .meta({ scope: { domain: "categories", level: "read" }, mcp: mcp("test_no_input") })
      .output(z.object({}))
      .handler(async () => ({}));
    rejects({ a: noInput }, ["a"], /a: no input schema/);

    const noOutput = procedures.storeProcedure
      .meta({ scope: { domain: "categories", level: "read" }, mcp: mcp("test_no_output") })
      .input(z.object({}))
      .handler(async () => ({}));
    rejects({ a: noOutput }, ["a"], /a: no output schema/);
  });

  test("refuses a procedure without an MCP exposure, or excluded from it", () => {
    const { z } = zod;
    const base = procedures.storeProcedure
      .input(z.object({}))
      .output(z.object({}))
      .handler(async () => ({}));
    rejects(
      { a: base.meta({ scope: { domain: "categories", level: "read" } }) },
      ["a"],
      /a: no meta\.mcp/,
    );
    rejects(
      {
        a: base.meta({
          scope: { domain: "categories", level: "read" },
          mcp: { exclude: "dashboard only" },
        }),
      },
      ["a"],
      /a: meta\.mcp excludes it \(dashboard only\)/,
    );
  });

  test("refuses what only a session or platform staff may call", () => {
    rejects({ a: valid().meta({ actors: ["session"] }) }, ["a"], /a: only a session may call it/);
    rejects({ a: valid().meta({ platformAdmin: true }) }, ["a"], /a: reserved to platform staff/);
  });

  test("refuses an input or an output that is not an object", () => {
    const { z } = zod;
    const scalarInput = procedures.storeProcedure
      .meta({ scope: { domain: "categories", level: "read" }, mcp: mcp("test_scalar_in") })
      .input(z.string())
      .output(z.object({}))
      .handler(async () => ({}));
    rejects({ a: scalarInput }, ["a"], /a: its input is not an object/);

    const listOutput = procedures.storeProcedure
      .meta({ scope: { domain: "categories", level: "read" }, mcp: mcp("test_list_out") })
      .input(z.object({}))
      .output(z.array(z.string()))
      .handler(async () => []);
    rejects({ a: listOutput }, ["a"], /a: its output is not an object/);
  });

  test("refuses an input that uses an argument the MCP bridge adds", () => {
    const { z } = zod;
    const clash = procedures.storeProcedure
      .meta({ scope: { domain: "categories", level: "write" }, mcp: mcp("test_clash") })
      .input(z.object({ idempotencyKey: z.string() }))
      .output(z.object({}))
      .handler(async () => ({}));
    rejects({ a: clash }, ["a"], /a: its input uses idempotencyKey/);
  });

  test("refuses a path listed twice and a tool name used twice", () => {
    rejects({ a: valid() }, ["a", "a"], /a: listed twice/);
    rejects({ a: valid("same"), b: valid("same") }, ["a", "b"], /b: tool name same is taken/);
  });
});
