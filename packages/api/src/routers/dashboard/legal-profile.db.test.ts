import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "legal-profile-test-secret";
process.env.NODE_ENV = "test";
// Billing marks and the card gate work only with the billing service on.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@lp.test` } } : null;
        },
      },
    },
  },
});

// The store's legal profile and the company registry, end to end through
// `call()`: the dashboard's session and an agent's API key, on the database.
// The registry's HTTP API is replaced by a fake fetch.

const OWNER = "lp_owner_user_000001";
const MEMBER = "lp_member_user_00001";
const STORE = "lp_store_a_000000001";
const OTHER_STORE = "lp_store_b_000000001";
/** What stores.create leaves: payment mode, a country, a currency, the default hours. */
const SETTINGS = {
  reservationMode: "payment",
  advanceNoticeMinutes: 60,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
} as const;

describe("legal profile procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./settings").dashboardSettingsRouter;

  const events: ApiEvent[] = [];
  const dispatched: string[][] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: (ids: readonly string[]) => {
      dispatched.push([...ids]);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_legal_profile");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardSettingsRouter: router } = await import("./settings"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@lp.test" },
      { id: MEMBER, email: "member@lp.test" },
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

  beforeEach(async () => {
    events.length = 0;
    dispatched.length = 0;
    const { db } = louezDb;
    for (const table of [
      louezDb.billingSyncQueue,
      louezDb.billingPolicies,
      louezDb.apiEffects,
      louezDb.storeLegalProfiles,
      louezDb.storeLocations,
      louezDb.reservations,
      louezDb.products,
      louezDb.categories,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    // A store as an agent leaves it after stores.create: offline, nothing else set.
    await db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Brest Surf", slug: "lp-brest-surf", settings: SETTINGS },
      { id: OTHER_STORE, userId: OWNER, name: "Other", slug: "lp-other", settings: SETTINGS },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  function session(userId = OWNER, store = STORE, extra: Record<string, string> = {}) {
    return {
      headers: new Headers({
        [SESSION_HEADER]: userId,
        cookie: `louez_active_store=${store}`,
        ...extra,
      }),
      transport: "rpc" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const agent: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "write",
  };

  async function apiKey(
    options: { permissions?: Permissions; storeId?: string; userId?: string } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: options.userId ?? OWNER,
      name: "Legal agent",
      permissions: options.permissions ?? agent,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "mcp" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "settings"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as { data: { code: string; details?: Record<string, unknown> } };
  }

  const tokenOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { confirmationToken: string }).confirmationToken;

  async function profileRow(storeId = STORE) {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.storeLegalProfiles)
      .where(orm.eq(louezDb.storeLegalProfiles.storeId, storeId));
    return row;
  }

  async function marks() {
    const { billingSyncQueue: queue, db } = louezDb;
    return db.select({ type: queue.aggregateType, id: queue.aggregateId }).from(queue);
  }

  /** The identity of a SAS in Brest, as an agent sends it. */
  const IDENTITY = {
    legalName: "Brest Surf SAS",
    legalForm: "SAS",
    companyNumber: "123 456 789",
    siret: "12345678900012",
    registeredAddress: "2 Quai de la Douane",
    registeredPostalCode: "29200",
    registeredCity: "Brest",
  };

  // --- The profile ----------------------------------------------------------

  test("an agent saves the identity directly; the store is marked; the profile reads back", async () => {
    const key = await apiKey();
    assert.equal((await run("getLegalProfile", {}, key())).profile, null);
    const saved = await run("upsertLegalProfile", IDENTITY, key());
    assert.equal(saved.profile.legalName, "Brest Surf SAS");
    // The country is the store's; the scheme follows it.
    assert.equal(saved.profile.country, "FR");
    assert.equal(saved.profile.companyNumberScheme, "fr_siren");
    assert.equal(saved.profile.invoicingEnabled, false);
    assert.equal(saved.profile.vatNumber, null);
    assert.equal(
      saved.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/invoicing?store=${STORE}`,
    );
    assert.deepEqual(await marks(), [{ type: "store", id: STORE }]);
    assert.deepEqual(
      events.map((event) => event.type),
      ["store.legalProfileUpdated"],
    );
    const read = await run("getLegalProfile", {}, session());
    assert.deepEqual(read.profile, saved.profile);
  });

  test("a partial update keeps the other fields; null clears an optional one", async () => {
    await run("upsertLegalProfile", { ...IDENTITY, vatNumber: "FR12123456789" }, session());
    const updated = await run(
      "upsertLegalProfile",
      { registeredCity: "Le Relecq-Kerhuon", vatNumber: null, shareCapital: "1000,5" },
      session(),
    );
    assert.equal(updated.profile.registeredCity, "Le Relecq-Kerhuon");
    assert.equal(updated.profile.legalName, "Brest Surf SAS");
    assert.equal(updated.profile.siret, "12345678900012");
    assert.equal(updated.profile.vatNumber, null);
    // Normalised as the dashboard's form does.
    assert.equal(updated.profile.shareCapital, "1000.50");
  });

  test("the dashboard form's rules: a first save needs the identity, a SIREN has 9 digits", async () => {
    const incomplete = await rejects(
      run("upsertLegalProfile", { legalName: "Brest Surf SAS" }, session()),
      "LEGAL_PROFILE_INVALID",
    );
    const problems = (
      incomplete.data.details as { problems: Array<{ field: string; problem: string }> }
    ).problems;
    assert.deepEqual(problems.map((entry) => entry.field).sort(), [
      "companyNumber",
      "legalForm",
      "registeredAddress",
      "registeredCity",
      "registeredPostalCode",
    ]);
    assert.ok(problems.every((entry) => entry.problem === "required"));

    const badSiren = await rejects(
      run("upsertLegalProfile", { ...IDENTITY, companyNumber: "1234" }, session()),
      "LEGAL_PROFILE_INVALID",
    );
    assert.deepEqual((badSiren.data.details as { problems: unknown[] }).problems, [
      { field: "companyNumber", problem: "format" },
    ]);
    // A Belgian company takes its 10-digit BCE number.
    const belgian = await run(
      "upsertLegalProfile",
      { ...IDENTITY, siret: null, country: "BE", companyNumber: "0123456789" },
      session(),
    );
    assert.equal(belgian.profile.companyNumberScheme, "be_bce");
    // Electronic invoicing needs the VAT regime.
    await rejects(
      run("upsertLegalProfile", { invoicingEnabled: true }, session()),
      "LEGAL_PROFILE_INVALID",
    );
    assert.equal((await profileRow())?.invoicingEnabled, false);
  });

  test("electronic invoicing is confirmed by an agent; a change since voids the token", async () => {
    const key = await apiKey();
    await run("upsertLegalProfile", IDENTITY, key());
    const turnOn = { invoicingEnabled: true, vatRegime: "monthly" as const };
    const refusal = await rejects(
      run("upsertLegalProfile", turnOn, key()),
      "CONFIRMATION_REQUIRED",
    );
    const preview = (refusal.data.details as { preview: { summary: string; details: unknown } })
      .preview;
    assert.match(preview.summary, /legal electronic invoices/);
    assert.deepEqual(preview.details, {
      changes: {
        invoicingEnabled: { from: false, to: true },
        vatRegime: { from: null, to: "monthly" },
      },
    });
    assert.equal((await profileRow())?.invoicingEnabled, false);

    // The dashboard sets the VAT regime meanwhile: the preview no longer holds.
    await run("upsertLegalProfile", { vatRegime: "quarterly" }, session());
    await rejects(
      run("upsertLegalProfile", turnOn, key({ "louez-confirmation": tokenOf(refusal) })),
      "CONFIRMATION_INVALID",
    );
    const fresh = await rejects(run("upsertLegalProfile", turnOn, key()), "CONFIRMATION_REQUIRED");
    const done = await run(
      "upsertLegalProfile",
      turnOn,
      key({ "louez-confirmation": tokenOf(fresh) }),
    );
    assert.equal(done.profile.invoicingEnabled, true);
    assert.equal(done.profile.vatRegime, "monthly");
    // The identity alone still saves directly once invoicing is on.
    assert.equal(
      (await run("upsertLegalProfile", { rcsCity: "Brest" }, key())).profile.rcsCity,
      "Brest",
    );
  });

  test("two writes of different fields at once keep both", async () => {
    await run("upsertLegalProfile", IDENTITY, session());
    await raceOnLockedRow(database, { table: "stores", id: STORE }, [
      () => run("upsertLegalProfile", { rcsCity: "Brest" }, session()),
      () => run("upsertLegalProfile", { vatNumber: "FR12123456789" }, session()),
    ]);
    const row = await profileRow();
    assert.equal(row?.rcsCity, "Brest");
    assert.equal(row?.vatNumber, "FR12123456789");
  });

  test("rights and stores: reading needs settings read, saving manage_settings; each store its own", async () => {
    const reader = await apiKey({ permissions: { ...agent, settings: "read" } });
    assert.equal((await run("getLegalProfile", {}, reader())).profile, null);
    await rejects(run("upsertLegalProfile", IDENTITY, reader()), "PERMISSION_DENIED");
    const none = await apiKey({ permissions: { ...agent, settings: "none" } });
    await rejects(run("getLegalProfile", {}, none()), "PERMISSION_DENIED");
    await rejects(
      run("searchCompanyRegistry", { query: "brest surf" }, none()),
      "PERMISSION_DENIED",
    );
    await rejects(run("upsertLegalProfile", IDENTITY, session(MEMBER)), "PERMISSION_DENIED");
    const memberKey = await apiKey({ userId: MEMBER });
    await rejects(run("upsertLegalProfile", IDENTITY, memberKey()), "PERMISSION_DENIED");

    const other = await apiKey({ storeId: OTHER_STORE });
    await run("upsertLegalProfile", { ...IDENTITY, legalName: "Other SARL" }, other());
    assert.equal((await run("getLegalProfile", {}, session())).profile, null);
    assert.equal(
      (await run("getLegalProfile", {}, session(OWNER, OTHER_STORE))).profile?.legalName,
      "Other SARL",
    );
  });

  // --- The registry ---------------------------------------------------------

  test("the registry's matches come flattened; an outage answers available: false", async () => {
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    try {
      globalThis.fetch = (async (url: URL | string) => {
        asked.push(String(url));
        return new Response(
          JSON.stringify({
            results: [
              {
                siren: "123456789",
                nom_raison_sociale: "BREST SURF",
                nature_juridique: "5710",
                etat_administratif: "A",
                siege: {
                  siret: "12345678900012",
                  numero_voie: "2",
                  type_voie: "QUAI",
                  libelle_voie: "DE LA DOUANE",
                  code_postal: "29200",
                  libelle_commune: "BREST",
                },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      const key = await apiKey({ permissions: { ...agent, settings: "read" } });
      const found = await run("searchCompanyRegistry", { query: "brest surf" }, key());
      assert.equal(found.available, true);
      assert.deepEqual(found.results, [
        {
          siren: "123456789",
          siret: "12345678900012",
          legalName: "BREST SURF",
          legalForm: "SAS",
          // FR + (12 + 3 × (SIREN mod 97)) mod 97 + SIREN.
          vatNumber: "FR32123456789",
          address: "2 QUAI DE LA DOUANE",
          addressComplement: "",
          postalCode: "29200",
          city: "BREST",
          rcsCity: "BREST",
          isActive: true,
        },
      ]);
      assert.match(asked[0] ?? "", /recherche-entreprises\.api\.gouv\.fr\/search\?q=brest\+surf/);

      globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
      assert.deepEqual(await run("searchCompanyRegistry", { query: "brest surf" }, key()), {
        available: false,
        results: [],
      });
      // A query too short never reaches the registry.
      await rejects(run("searchCompanyRegistry", { query: "br" }, key()), "BAD_REQUEST");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
