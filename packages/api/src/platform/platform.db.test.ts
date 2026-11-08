import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createMemoryStorage } from "./memory-storage";
import { createTestNewStores } from "./test-new-stores";
import { createTestUrls } from "./test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/utils/sanitize-rich-text"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// The agent-ready platform end to end, through `call()`: who may call, on
// which store, with which rights; idempotent writes; confirmations.

const OWNER = "pl_owner_user_000001";
const MEMBER = "pl_member_user_00001";
const STORE = "pl_store_a_000000001";
const OTHER_STORE = "pl_store_b_000000001";

describe("agent-ready platform", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let procedures: typeof import("./procedures");
  let confirmation: typeof import("./confirmation");
  let apiKeys: typeof import("../services/api-keys");
  let zod: typeof import("zod");

  let apiAccess = true;
  const ports = {
    planFeatures: async () => ({ apiAccess }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("agent_platform");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    procedures = await import("./procedures");
    confirmation = await import("./confirmation");
    apiKeys = await import("../services/api-keys");
    zod = await import("zod");

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@pl.test" },
      { id: MEMBER, email: "member@pl.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "pl-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "pl-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const allRead: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };
  const allWrite: Permissions = {
    ...allRead,
    reservations: "write",
    categories: "write",
    settings: "write",
  };

  async function key(
    options: {
      userId?: string;
      storeId?: string;
      permissions?: Permissions;
      confirmSensitive?: boolean;
    } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: options.userId ?? OWNER,
      name: "Test agent",
      permissions: options.permissions ?? allWrite,
    });
    if (options.confirmSensitive === false) {
      await apiKeys.setApiKeyConfirmation({
        db: louezDb.db,
        storeId: options.storeId ?? STORE,
        keyId: created.id,
        confirmSensitive: false,
      });
    }
    return created;
  }

  let orm: typeof import("drizzle-orm");
  before(async () => {
    orm = await import("drizzle-orm");
  });

  function context(transport: "rpc" | "openapi" | "mcp", headers: Record<string, string> = {}) {
    return {
      headers: new Headers(headers),
      transport,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    };
  }
  const bearer = (raw: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${raw}`,
    ...extra,
  });

  async function rejects(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, code, String(error));
      return true;
    });
  }

  const readCategories = () =>
    procedures.storeProcedure
      .meta({ capability: "test.read", scope: { domain: "categories", level: "read" } })
      .handler(async ({ context }) => ({
        storeId: context.actor.storeId,
        via: context.actor.transport,
      }));

  test("each transport takes only its credentials, and a bad one never falls back", async () => {
    const { key: raw } = await key();
    const read = readCategories();

    // A key on the dashboard's RPC endpoint is refused, even with a cookie.
    await rejects(
      orpc.call(read, undefined, { context: context("rpc", bearer(raw, { cookie: "x=y" })) }),
      "CREDENTIAL_NOT_ACCEPTED",
    );
    // OpenAPI wants a key: no credential, refused.
    await rejects(orpc.call(read, undefined, { context: context("openapi") }), "UNAUTHENTICATED");
    // A token that is not a key is refused on OpenAPI; on MCP it is an OAuth
    // access token (platform/oauth.db.test.ts).
    await rejects(
      orpc.call(read, undefined, { context: context("openapi", bearer("eyJ.some.jwt")) }),
      "CREDENTIAL_NOT_ACCEPTED",
    );
    // An invalid key is refused.
    await rejects(
      orpc.call(read, undefined, { context: context("mcp", bearer("lz_abcd_nope")) }),
      "UNAUTHENTICATED",
    );

    assert.deepEqual(await orpc.call(read, undefined, { context: context("mcp", bearer(raw)) }), {
      storeId: STORE,
      via: "mcp",
    });
    assert.deepEqual(
      await orpc.call(read, undefined, { context: context("openapi", bearer(raw)) }),
      { storeId: STORE, via: "openapi" },
    );
  });

  test("a revoked key, or an owner who left the store, stops working on the next call", async () => {
    const read = readCategories();

    const revoked = await key();
    assert.ok(await orpc.call(read, undefined, { context: context("mcp", bearer(revoked.key)) }));
    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: revoked.id });
    await rejects(
      orpc.call(read, undefined, { context: context("mcp", bearer(revoked.key)) }),
      "UNAUTHENTICATED",
    );

    const leaving = await key({ userId: MEMBER });
    assert.ok(await orpc.call(read, undefined, { context: context("mcp", bearer(leaving.key)) }));
    await louezDb.db
      .delete(louezDb.storeMembers)
      .where(
        orm.and(
          orm.eq(louezDb.storeMembers.storeId, STORE),
          orm.eq(louezDb.storeMembers.userId, MEMBER),
        ),
      );
    await rejects(
      orpc.call(read, undefined, { context: context("mcp", bearer(leaving.key)) }),
      "NO_STORE_ACCESS",
    );
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: MEMBER, role: "member" });
  });

  test("a key works on its store only", async () => {
    const { key: raw } = await key();
    await rejects(
      orpc.call(readCategories(), undefined, {
        context: context("mcp", bearer(raw, { "louez-store": OTHER_STORE })),
      }),
      "NO_STORE_ACCESS",
    );
  });

  test("rights: the member's role, cut down to the key's scopes", async () => {
    const write = procedures.storeProcedure
      .meta({ capability: "test.write", scope: { domain: "categories", level: "write" } })
      .handler(async () => ({ ok: true }));
    const remove = procedures.storeProcedure
      .meta({
        capability: "test.delete",
        scope: { domain: "categories", level: "write", role: "delete" },
      })
      .handler(async () => ({ ok: true }));

    const readOnly = await key({ permissions: allRead });
    await rejects(
      orpc.call(write, undefined, { context: context("mcp", bearer(readOnly.key)) }),
      "PERMISSION_DENIED",
    );
    assert.ok(
      await orpc.call(readCategories(), undefined, {
        context: context("mcp", bearer(readOnly.key)),
      }),
    );

    const noTeam = await key();
    const team = procedures.storeProcedure
      .meta({ capability: "test.team", scope: { domain: "team", level: "read" } })
      .handler(async () => ({ ok: true }));
    // `team` did not exist when this key's permissions were written: none.
    await rejects(
      orpc.call(team, undefined, { context: context("mcp", bearer(noTeam.key)) }),
      "PERMISSION_DENIED",
    );

    // A member's key with write scopes still cannot delete: the role forbids it.
    const memberKey = await key({ userId: MEMBER });
    assert.deepEqual(
      await orpc.call(write, undefined, { context: context("mcp", bearer(memberKey.key)) }),
      { ok: true },
    );
    await rejects(
      orpc.call(remove, undefined, { context: context("mcp", bearer(memberKey.key)) }),
      "PERMISSION_DENIED",
    );
  });

  test("session-only procedures refuse every key, so an agent cannot mint itself a stronger key", async () => {
    const { key: raw } = await key();
    const credentials = procedures.storeProcedure
      .meta({
        capability: "test.keys",
        scope: { domain: "settings", level: "write", role: "manage_settings" },
        actors: ["session"],
      })
      .handler(async () => ({ ok: true }));
    await rejects(
      orpc.call(credentials, undefined, { context: context("mcp", bearer(raw)) }),
      "SESSION_ONLY",
    );

    const { dashboardApiKeysRouter } = await import("../routers/dashboard/api-keys");
    await rejects(
      orpc.call(
        dashboardApiKeysRouter.create,
        { name: "escalated", permissions: allWrite },
        { context: context("mcp", bearer(raw)) },
      ),
      "SESSION_ONLY",
    );
    await rejects(
      orpc.call(dashboardApiKeysRouter.list, undefined, {
        context: context("openapi", bearer(raw)),
      }),
      "SESSION_ONLY",
    );
    await rejects(
      orpc.call(
        dashboardApiKeysRouter.updateConfirmation,
        { keyId: "any", confirmSensitive: false },
        { context: context("mcp", bearer(raw)) },
      ),
      "SESSION_ONLY",
    );

    // Account-level procedures keep the same guards.
    const staffOnly = procedures.accountProcedure
      .meta({ capability: "test.staff", actors: ["session"], platformAdmin: true })
      .handler(async () => ({ ok: true }));
    await rejects(
      orpc.call(staffOnly, undefined, { context: context("mcp", bearer(raw)) }),
      "SESSION_ONLY",
    );
  });

  test("platform staff with no store chosen land where the dashboard puts them: the first store of all", async () => {
    const { resolveStoreActor } = await import("./actor");
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: "pl_store_0_000000001", userId: MEMBER, name: "0 first", slug: "pl-store-0" });
    const staff = {
      transport: "rpc" as const,
      isPlatformAdmin: true,
      credential: {
        kind: "session" as const,
        id: null,
        clientName: null,
        userId: OWNER,
        email: "owner@pl.test",
        storeId: null,
        stores: null,
        scopes: null,
        confirmSensitive: false,
        bundles: null,
      },
    };
    const resolved = await resolveStoreActor(staff, { headers: new Headers() });
    assert.equal(resolved.storeId, "pl_store_0_000000001");
    assert.equal(resolved.role, "platform_admin");

    const member = await resolveStoreActor(
      { ...staff, isPlatformAdmin: false },
      { headers: new Headers() },
    );
    assert.equal(member.storeId, STORE, "a regular user lands on their first own store");
    assert.equal(member.role, "owner");

    const fromCookie = await resolveStoreActor(staff, {
      headers: new Headers({ cookie: `louez_active_store=${OTHER_STORE}` }),
    });
    assert.equal(fromCookie.storeId, OTHER_STORE);
    assert.equal(fromCookie.role, "owner");
    await louezDb.db
      .delete(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, "pl_store_0_000000001"));
  });

  test("a store whose plan has no API access refuses keys", async () => {
    const { key: raw } = await key();
    apiAccess = false;
    try {
      await rejects(
        orpc.call(readCategories(), undefined, { context: context("mcp", bearer(raw)) }),
        "API_ACCESS_NOT_IN_PLAN",
      );
    } finally {
      apiAccess = true;
    }
  });

  test("a procedure without a scope is refused, never left open", async () => {
    const { key: raw } = await key();
    const open = procedures.storeProcedure.handler(async () => ({ ok: true }));
    await rejects(
      orpc.call(open, undefined, { context: context("mcp", bearer(raw)) }),
      "PROCEDURE_WITHOUT_SCOPE",
    );
  });

  describe("writes", () => {
    let runs = 0;
    const create = () =>
      procedures.storeProcedure
        .meta({ capability: "test.create", scope: { domain: "categories", level: "write" } })
        .input(zod.z.object({ name: zod.z.string() }))
        .handler(async ({ input }) => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 30));
          if (input.name === "boom") throw new Error("boom");
          return {
            id: `cat_${runs}`,
            name: input.name,
            createdAt: new Date("2026-11-07T10:00:00Z"),
          };
        });

    test("every write is recorded with who, how and the outcome", async () => {
      const { key: raw, id } = await key();
      const ctx = context("mcp", bearer(raw));
      const result = await orpc.call(create(), { name: "Tents" }, { context: ctx });

      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.id, ctx.receipt.operationId!));
      assert.equal(row.transport, "mcp");
      assert.equal(row.credentialKind, "api_key");
      assert.equal(row.credentialId, id);
      assert.equal(row.clientName, "Test agent");
      assert.equal(row.status, "succeeded");
      assert.equal(row.targetId, result.id);
      assert.equal(row.result, null, "no key, nothing to replay, nothing kept");
    });

    test("the same idempotency key replays the result without running again", async () => {
      const { key: raw } = await key();
      const headers = bearer(raw, { "idempotency-key": "retry-1" });
      const before = runs;
      const first = await orpc.call(
        create(),
        { name: "Kayaks" },
        { context: context("mcp", headers) },
      );
      const replayCtx = context("mcp", headers);
      const second = await orpc.call(create(), { name: "Kayaks" }, { context: replayCtx });
      assert.equal(runs, before + 1);
      assert.deepEqual(second, first);
      assert.ok(second.createdAt instanceof Date, "dates come back as dates");
      assert.equal(replayCtx.receipt.replayed, true);

      await rejects(
        orpc.call(create(), { name: "Bikes" }, { context: context("mcp", headers) }),
        "IDEMPOTENCY_KEY_REUSED",
      );
    });

    test("two retries arriving together run once", async () => {
      const { key: raw } = await key();
      const headers = bearer(raw, { "idempotency-key": "together" });
      const before = runs;
      const settled = await Promise.allSettled([
        orpc.call(create(), { name: "Boards" }, { context: context("mcp", headers) }),
        orpc.call(create(), { name: "Boards" }, { context: context("mcp", headers) }),
      ]);
      assert.equal(runs, before + 1);
      const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
      assert.ok(fulfilled.length >= 1);
      for (const entry of settled) {
        if (entry.status === "rejected") {
          assert.equal(
            (entry.reason as { data?: { code?: string } }).data?.code,
            "OPERATION_IN_PROGRESS",
          );
        }
      }
    });

    test("a failed call may be retried with the same key", async () => {
      const { key: raw } = await key();
      const headers = bearer(raw, { "idempotency-key": "fails-once" });
      await assert.rejects(
        orpc.call(create(), { name: "boom" }, { context: context("mcp", headers) }),
      );
      const before = runs;
      await assert.rejects(
        orpc.call(create(), { name: "boom" }, { context: context("mcp", headers) }),
      );
      assert.equal(runs, before + 1, "it ran again");
    });

    test("the key is matched on the validated input, not on its raw spelling", async () => {
      const { key: raw } = await key();
      const trimmed = procedures.storeProcedure
        .meta({ capability: "test.trimmed", scope: { domain: "categories", level: "write" } })
        .input(zod.z.object({ name: zod.z.string().trim(), qty: zod.z.coerce.number() }))
        .output(zod.z.object({ id: zod.z.string(), name: zod.z.string() }))
        .handler(async ({ input }) => ({
          id: `t_${input.name}`,
          name: input.name,
          secret: "not in the contract",
        }));
      const headers = bearer(raw, { "idempotency-key": "normalized" });
      const first = await orpc.call(
        trimmed,
        { name: " Tent ", qty: "1" },
        { context: context("mcp", headers) },
      );
      const replayCtx = context("mcp", headers);
      const second = await orpc.call(trimmed, { name: "Tent", qty: 1 }, { context: replayCtx });
      assert.equal(replayCtx.receipt.replayed, true);
      assert.deepEqual(second, first);
      assert.deepEqual(
        Object.keys(second).sort(),
        ["id", "name"],
        "the replay goes through the output schema too",
      );
      const [stored] = await louezDb.db
        .select({ result: louezDb.apiOperations.result })
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.id, replayCtx.receipt.operationId!));
      assert.deepEqual(
        stored.result,
        { id: "t_Tent", name: "Tent" },
        "what the contract drops is never kept",
      );
    });

    test("an operation whose outcome was not recorded refuses retries", async () => {
      const { key: raw } = await key();
      const headers = bearer(raw, { "idempotency-key": "lost-outcome" });
      const ctx = context("mcp", headers);
      await orpc.call(create(), { name: "Lost" }, { context: ctx });
      await louezDb.db
        .update(louezDb.apiOperations)
        .set({ status: "unknown" })
        .where(orm.eq(louezDb.apiOperations.id, ctx.receipt.operationId!));
      const before = runs;
      await rejects(
        orpc.call(create(), { name: "Lost" }, { context: context("mcp", headers) }),
        "OPERATION_OUTCOME_UNKNOWN",
      );
      assert.equal(runs, before);
    });

    test("a call left running past its lease is lost, never run again", async () => {
      const { key: raw } = await key();
      const headers = bearer(raw, { "idempotency-key": "stranded" });
      const ctx = context("mcp", headers);
      await orpc.call(create(), { name: "Stranded" }, { context: ctx });
      await louezDb.db.execute(
        orm.sql`UPDATE api_operations SET status = 'running', updated_at = NOW() - INTERVAL 1 HOUR WHERE id = ${ctx.receipt.operationId!}`,
      );
      const before = runs;
      await rejects(
        orpc.call(create(), { name: "Stranded" }, { context: context("mcp", headers) }),
        "OPERATION_OUTCOME_UNKNOWN",
      );
      assert.equal(runs, before);
    });

    test("keys of different connections never collide", async () => {
      const a = await key();
      const b = await key();
      const first = await orpc.call(
        create(),
        { name: "Shared" },
        { context: context("mcp", bearer(a.key, { "idempotency-key": "same" })) },
      );
      const second = await orpc.call(
        create(),
        { name: "Shared" },
        { context: context("mcp", bearer(b.key, { "idempotency-key": "same" })) },
      );
      assert.notEqual(first.id, second.id);
    });
  });

  describe("confirmation of sensitive operations", () => {
    let executed = 0;
    let amount = 50;
    const refund = () =>
      procedures.storeProcedure
        .meta({
          capability: "test.refund",
          scope: { domain: "payments", level: "write" },
          sensitive: "money",
        })
        .input(zod.z.object({ paymentId: zod.z.string() }))
        .handler(async ({ context, input }) => {
          await confirmation.requireConfirmation({
            actor: context.actor,
            headers: context.headers,
            procedure: "test.refund",
            input,
            state: { amount },
            preview: { summary: `Refund ${amount} EUR.`, details: { amount } },
          });
          executed += 1;
          return { ok: true };
        });

    async function tokenFrom(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
      } catch (error) {
        const data = (
          error as { data?: { code?: string; details?: { confirmationToken?: string } } }
        ).data;
        assert.equal(data?.code, "CONFIRMATION_REQUIRED");
        assert.ok(data?.details?.confirmationToken);
        return data.details.confirmationToken;
      }
      throw new Error("expected CONFIRMATION_REQUIRED");
    }

    const paymentsWrite: Permissions = { ...allWrite, payments: "write" };

    test("a connection that asks for it: preview first, then the token runs it once", async () => {
      const { key: raw } = await key({ permissions: paymentsWrite });
      const before = executed;
      const token = await tokenFrom(
        orpc.call(refund(), { paymentId: "p1" }, { context: context("mcp", bearer(raw)) }),
      );
      assert.equal(executed, before, "the preview did nothing");

      assert.deepEqual(
        await orpc.call(
          refund(),
          { paymentId: "p1" },
          { context: context("mcp", bearer(raw, { "louez-confirmation": token })) },
        ),
        { ok: true },
      );
      assert.equal(executed, before + 1);
      await rejects(
        orpc.call(
          refund(),
          { paymentId: "p1" },
          { context: context("mcp", bearer(raw, { "louez-confirmation": token })) },
        ),
        "CONFIRMATION_INVALID",
      );
    });

    test("the token stops matching when the input, the state or the connection change", async () => {
      const { key: raw } = await key({ permissions: paymentsWrite });
      const other = await key({ permissions: paymentsWrite });

      const forInput = await tokenFrom(
        orpc.call(refund(), { paymentId: "p2" }, { context: context("mcp", bearer(raw)) }),
      );
      await rejects(
        orpc.call(
          refund(),
          { paymentId: "p3" },
          { context: context("mcp", bearer(raw, { "louez-confirmation": forInput })) },
        ),
        "CONFIRMATION_INVALID",
      );

      const forState = await tokenFrom(
        orpc.call(refund(), { paymentId: "p4" }, { context: context("mcp", bearer(raw)) }),
      );
      amount = 80;
      await rejects(
        orpc.call(
          refund(),
          { paymentId: "p4" },
          { context: context("mcp", bearer(raw, { "louez-confirmation": forState })) },
        ),
        "CONFIRMATION_INVALID",
      );
      amount = 50;

      const forConnection = await tokenFrom(
        orpc.call(refund(), { paymentId: "p5" }, { context: context("mcp", bearer(raw)) }),
      );
      await rejects(
        orpc.call(
          refund(),
          { paymentId: "p5" },
          { context: context("mcp", bearer(other.key, { "louez-confirmation": forConnection })) },
        ),
        "CONFIRMATION_INVALID",
      );
    });

    test("an expired token is refused", async () => {
      const { key: raw } = await key({ permissions: paymentsWrite });
      const token = await tokenFrom(
        orpc.call(refund(), { paymentId: "p6" }, { context: context("mcp", bearer(raw)) }),
      );
      await louezDb.db
        .update(louezDb.apiConfirmations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(orm.eq(louezDb.apiConfirmations.id, token));
      await rejects(
        orpc.call(
          refund(),
          { paymentId: "p6" },
          { context: context("mcp", bearer(raw, { "louez-confirmation": token })) },
        ),
        "CONFIRMATION_INVALID",
      );
    });

    test("a connection set to run directly runs at once", async () => {
      const { key: raw } = await key({ permissions: paymentsWrite, confirmSensitive: false });
      const before = executed;
      assert.deepEqual(
        await orpc.call(refund(), { paymentId: "p7" }, { context: context("mcp", bearer(raw)) }),
        { ok: true },
      );
      assert.equal(executed, before + 1);
    });
  });
  test("the rate limit is one counter per connection, shared by every instance", async () => {
    const { consumeRateLimit } = await import("./rate-limit");
    const limit = { windowMs: 60_000, max: 2 };
    const now = 1_800_000_000_000;
    assert.deepEqual(await consumeRateLimit("test:a", limit, now), { allowed: true });
    assert.deepEqual(await consumeRateLimit("test:a", limit, now + 1), { allowed: true });
    const refused = await consumeRateLimit("test:a", limit, now + 2);
    assert.equal(refused.allowed, false);
    assert.deepEqual(
      await consumeRateLimit("test:b", limit, now + 3),
      { allowed: true },
      "another connection",
    );
    assert.deepEqual(
      await consumeRateLimit("test:a", limit, now + 60_000),
      { allowed: true },
      "next window",
    );

    // Concurrent calls each get their own rank: exactly `max` pass.
    const together = await Promise.all(
      [1, 2, 3, 4].map(() => consumeRateLimit("test:c", limit, now)),
    );
    assert.equal(together.filter((entry) => entry.allowed).length, 2);

    // A late call from an older window counts in the newer one, never resets it.
    assert.equal((await consumeRateLimit("test:d", limit, now + 60_000)).allowed, true);
    assert.equal((await consumeRateLimit("test:d", limit, now + 60_001)).allowed, true);
    assert.equal((await consumeRateLimit("test:d", limit, now + 59_999)).allowed, false);
    assert.equal((await consumeRateLimit("test:d", limit, now + 60_002)).allowed, false);
  });
});
