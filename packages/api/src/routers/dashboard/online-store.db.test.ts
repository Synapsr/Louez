import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

// What the image ownership checks read, before the modules that read them load.
process.env.AUTH_SECRET ??= "online-store-test-secret";
process.env.S3_PUBLIC_URL = "https://files.louez.test";
process.env.NODE_ENV = "test";
// Billing marks are written only with the billing service on.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
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
          return id ? { user: { id, email: `${id}@os.test` } } : null;
        },
      },
    },
  },
});

// The online store procedures end to end, through `call()`: the editor's
// sections, the look and its images, and the store's web address.

const OWNER = "os_owner_user_000001";
const MEMBER = "os_member_user_00001";
const STORE = "os_store_a_000000001";
const OTHER_STORE = "os_store_b_000000001";
const SETTINGS = {
  reservationMode: "request",
  advanceNoticeMinutes: 60,
  currency: "EUR",
  seo: { googleSiteVerification: "existing-owner-token" },
} as const;
const LOGO = `https://files.louez.test/${STORE}/logo/aaaaaaaaaaaaaaaaaaaaa.png`;
const OTHER_LOGO = `https://files.louez.test/${OTHER_STORE}/logo/aaaaaaaaaaaaaaaaaaaaa.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("online store procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./online-store").dashboardOnlineStoreRouter;

  const events: ApiEvent[] = [];
  const storage = createMemoryStorage();
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage,
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_online_store");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardOnlineStoreRouter: router } = await import("./online-store"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@os.test" },
      { id: MEMBER, email: "member@os.test" },
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
    const { db } = louezDb;
    await db.delete(louezDb.billingSyncQueue);
    await db.delete(louezDb.stores);
    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Brest Surf",
        slug: "os-brest-surf",
        settings: SETTINGS,
        onboardingCompleted: true,
      },
      { id: OTHER_STORE, userId: OWNER, name: "Other", slug: "os-other", settings: SETTINGS },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  function session(userId = OWNER, store = STORE) {
    return {
      headers: new Headers({ [SESSION_HEADER]: userId, cookie: `louez_active_store=${store}` }),
      transport: "rpc" as const,
      ports,
      receipt: {},
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const onlineStoreWrite: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
    online_store: "write",
  };

  async function apiKey(
    options: { permissions?: Permissions; storeId?: string; userId?: string } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: options.userId ?? OWNER,
      name: "Storefront agent",
      permissions: options.permissions ?? onlineStoreWrite,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi" as const,
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
      path: ["dashboard", "onlineStore"],
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

  async function storeRow(storeId = STORE) {
    const [row] = await louezDb.db
      .select({
        slug: louezDb.stores.slug,
        settings: louezDb.stores.settings,
        theme: louezDb.stores.theme,
        logoUrl: louezDb.stores.logoUrl,
      })
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, storeId));
    return row;
  }

  async function storeMarks() {
    const { billingSyncQueue: queue, db } = louezDb;
    return db
      .select({ id: queue.aggregateId })
      .from(queue)
      .where(orm.eq(queue.aggregateType, "store"));
  }

  // --- Web address ----------------------------------------------------------

  test("the slug check names the store's own address, a taken one and a reserved one", async () => {
    const key = await apiKey();
    assert.deepEqual(await run("checkSlugAvailability", { slug: "os-brest-surf" }, key()), {
      slug: "os-brest-surf",
      available: false,
      reason: null,
      suggestions: [],
      current: true,
    });
    const taken = await run("checkSlugAvailability", { slug: "os-other" }, key());
    assert.equal(taken.reason, "taken");
    assert.equal(taken.current, false);
    assert.ok(taken.suggestions.length > 0);
    assert.equal(
      (await run("checkSlugAvailability", { slug: "dashboard" }, key())).reason,
      "reserved",
    );
    assert.equal((await run("checkSlugAvailability", { slug: "os-free" }, key())).available, true);
  });

  test("a session moves the store at once and marks it; the same, taken or reserved address is refused", async () => {
    const moved = await run("updateSlug", { slug: "os-brest-surf-school" }, session());
    assert.equal(moved.previousSlug, "os-brest-surf");
    assert.equal(moved.oldLinksRedirect, false);
    assert.equal(moved.storefrontUrl, ports.urls.storefront("os-brest-surf-school", "/"));
    assert.equal(moved.links.dashboard, `${TEST_APP_URL}/online-store/identity?store=${STORE}`);
    assert.equal((await storeRow())?.slug, "os-brest-surf-school");
    assert.deepEqual(await storeMarks(), [{ id: STORE }]);
    assert.deepEqual(events.at(-1), {
      type: "store.slugChanged",
      store: { id: STORE, name: "Brest Surf", slug: "os-brest-surf-school", ownerUserId: OWNER },
      previousSlug: "os-brest-surf",
    });

    await rejects(
      run("updateSlug", { slug: "os-brest-surf-school" }, session()),
      "STORE_SLUG_UNCHANGED",
    );
    const taken = await rejects(
      run("updateSlug", { slug: "os-other" }, session()),
      "STORE_SLUG_TAKEN",
    );
    const suggestions = taken.data.details?.suggestions as string[] | undefined;
    assert.ok((suggestions ?? []).length > 0);
    await rejects(run("updateSlug", { slug: "dashboard" }, session()), "BAD_REQUEST");
  });

  test("an agent confirms a slug change; a tampered, replayed or stale token is refused", async () => {
    const key = await apiKey();
    const refusal = await rejects(
      run("updateSlug", { slug: "os-new" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    const preview = refusal.data.details?.preview as {
      summary: string;
      details: { previousUrl: string; url: string; oldLinksRedirect: boolean; online: boolean };
    };
    assert.match(preview.summary, /stops working/);
    assert.deepEqual(preview.details, {
      previousUrl: ports.urls.storefront("os-brest-surf", "/"),
      url: ports.urls.storefront("os-new", "/"),
      oldLinksRedirect: false,
      online: true,
    });
    assert.equal((await storeRow())?.slug, "os-brest-surf");

    const token = tokenOf(refusal);
    await rejects(
      run("updateSlug", { slug: "os-new" }, key({ "louez-confirmation": `${token}x` })),
      "CONFIRMATION_INVALID",
    );
    await rejects(
      run("updateSlug", { slug: "os-newer" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );
    await run("updateSlug", { slug: "os-new" }, key({ "louez-confirmation": token }));
    assert.equal((await storeRow())?.slug, "os-new");
    await rejects(
      run("updateSlug", { slug: "os-brest-surf" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );

    // The address changes between the preview and the call: the token is void.
    const second = await rejects(
      run("updateSlug", { slug: "os-later" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    await run("updateSlug", { slug: "os-meanwhile" }, session());
    await rejects(
      run("updateSlug", { slug: "os-later" }, key({ "louez-confirmation": tokenOf(second) })),
      "CONFIRMATION_INVALID",
    );
  });

  test("two stores taking the same address at once: one gets it, the other is told it is taken", async () => {
    const results = await raceOnOpenTransaction(
      database,
      async (holder) => {
        // Both calls pass the check, then wait on their store's lock.
        await holder.query("SELECT id FROM `stores` WHERE id IN (?, ?) FOR UPDATE", [
          STORE,
          OTHER_STORE,
        ]);
      },
      [STORE, OTHER_STORE].map(
        (store) => () =>
          run("updateSlug", { slug: "os-contested" }, session(OWNER, store)).then(
            () => "moved",
            (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
          ),
      ),
    );
    assert.deepEqual(results.sort(), ["STORE_SLUG_TAKEN", "moved"]);
  });

  // --- The editor -----------------------------------------------------------

  test("members and keys without the online store cannot save, nor read the slug check", async () => {
    await rejects(
      run("update", { seo: { googleSiteVerification: "x" } }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    await rejects(
      run("update", { seo: { shareImageUrl: null } }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    const old = await apiKey({ permissions: { ...onlineStoreWrite, online_store: undefined } });
    await rejects(run("checkSlugAvailability", { slug: "os-x" }, old()), "PERMISSION_DENIED");
    const memberKey = await apiKey({ userId: MEMBER });
    await rejects(run("updateAppearance", { mode: "dark" }, memberKey()), "PERMISSION_DENIED");
    assert.deepEqual((await storeRow())?.settings, SETTINGS);
  });

  test("the editor saves a verified token, clears it, and keeps it when only the share image changes", async () => {
    const saved = await run(
      "update",
      {
        seo: {
          googleSiteVerification:
            '<meta name="google-site-verification" content="new-owner-token" />',
        },
      },
      session(),
    );
    assert.equal(saved.links.dashboard, `${TEST_APP_URL}/online-store/identity?store=${STORE}`);
    assert.deepEqual((await storeRow())?.settings, {
      ...SETTINGS,
      seo: { googleSiteVerification: "new-owner-token" },
    });

    await run("update", { seo: { shareImageUrl: null } }, session());
    assert.equal((await storeRow())?.settings?.seo?.googleSiteVerification, "new-owner-token");
    assert.equal((await storeRow())?.theme?.shareImageUrl, null);

    await run("update", { seo: { googleSiteVerification: "  " } }, session());
    assert.deepEqual((await storeRow())?.settings, {
      ...SETTINGS,
      seo: { googleSiteVerification: null },
    });

    for (const token of ['"><script>alert(1)</script>', "token with spaces", "x".repeat(201)]) {
      await rejects(
        run("update", { seo: { googleSiteVerification: token } }, session()),
        "BAD_REQUEST",
      );
    }
  });

  test("the editor's identity takes the store's own images only, and refreshes the theme cache", async () => {
    const identity = {
      name: "Brest Surf",
      tagline: "<p>Waves all year</p>",
      description: "<p>Boards</p>",
      locale: "fr",
      logoUrl: LOGO,
      theme: { mode: "dark" as const, primaryColor: "#112233" },
    };
    await run("update", { identity }, session());
    const row = await storeRow();
    assert.equal(row?.logoUrl, LOGO);
    assert.equal(row?.theme?.mode, "dark");
    assert.deepEqual(events.at(-1), {
      type: "store.storefrontUpdated",
      store: { id: STORE, name: "Brest Surf", slug: "os-brest-surf", ownerUserId: OWNER },
      themeChanged: true,
    });
    await rejects(
      run("update", { identity: { ...identity, logoUrl: OTHER_LOGO } }, session()),
      "IMAGE_NOT_OWNED",
    );
  });

  // --- Look and images ------------------------------------------------------

  test("an agent uploads a logo and a banner, then sets them with the look", async () => {
    const key = await apiKey();
    const logo = await run(
      "createImageUpload",
      { kind: "logo", contentType: "image/png", size: PNG.byteLength },
      key(),
    );
    assert.match(logo.key, new RegExp(`^${STORE}/logo/`));
    await storage.put(logo.key, PNG, "image/png");
    const logoDone = await run("completeImageUpload", { kind: "logo", key: logo.key }, key());

    const hero = await run(
      "createImageUpload",
      { kind: "hero", contentType: "image/png", size: PNG.byteLength },
      key(),
    );
    await storage.put(hero.key, PNG, "image/png");
    const heroDone = await run("completeImageUpload", { kind: "hero", key: hero.key }, key());

    const look = await run(
      "updateAppearance",
      {
        primaryColor: "#0A7EA4",
        logoUrl: logoDone.url,
        heroImages: [heroDone.url],
        heroLayout: "split",
      },
      key(),
    );
    assert.equal(look.appearance.logoUrl, logoDone.url);
    assert.deepEqual(look.appearance.heroImages, [heroDone.url]);
    assert.equal(look.appearance.heroLayout, "split");
    assert.equal(look.appearance.mode, "light");
    assert.equal((events.at(-1) as { themeChanged?: boolean }).themeChanged, false);

    const removed = await run("updateAppearance", { logoUrl: null, mode: "dark" }, key());
    assert.equal(removed.appearance.logoUrl, null);
    assert.deepEqual(removed.appearance.heroImages, [heroDone.url]);
    assert.equal((events.at(-1) as { themeChanged?: boolean }).themeChanged, true);

    // Another store's upload is not this store's image.
    await rejects(run("updateAppearance", { logoUrl: OTHER_LOGO }, key()), "IMAGE_NOT_OWNED");
    const other = await apiKey({ storeId: OTHER_STORE });
    await rejects(
      run("completeImageUpload", { kind: "logo", key: logo.key }, other()),
      "UPLOAD_NOT_OWNED",
    );
  });
});
