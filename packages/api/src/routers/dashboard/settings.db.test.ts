import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "settings-test-secret";
process.env.NODE_ENV = "test";
// Billing marks are written only with the billing service on.
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
          return id ? { user: { id, email: `${id}@st.test` } } : null;
        },
      },
    },
  },
});

// The settings procedures end to end, through `call()`: the dashboard's
// session and an agent's API key, on the database.

const OWNER = "st_owner_user_000001";
const MEMBER = "st_member_user_00001";
const STORE = "st_store_a_000000001";
const OTHER_STORE = "st_store_b_000000001";
const SETTINGS = {
  reservationMode: "request",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
  // A section none of these procedures owns: every write keeps it.
  inspection: {
    enabled: true,
    mode: "optional",
    requireCustomerSignature: false,
    autoGeneratePdf: true,
    maxPhotosPerItem: 10,
  },
} as const;
const EXCLUSIVE_20 = { enabled: true, defaultRate: 20, displayMode: "exclusive" as const };

describe("settings procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./settings").dashboardSettingsRouter;

  const events: ApiEvent[] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_settings");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardSettingsRouter: router } = await import("./settings"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@st.test" },
      { id: MEMBER, email: "member@st.test" },
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
    await db.delete(louezDb.storeLocations);
    await db.delete(louezDb.reservations);
    await db.delete(louezDb.stores);
    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Brest Surf",
        slug: "st-brest-surf",
        settings: SETTINGS,
        latitude: "48.3904000",
        longitude: "-4.4861000",
      },
      { id: OTHER_STORE, userId: OWNER, name: "Other", slug: "st-other", settings: SETTINGS },
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
  const settingsWrite: Permissions = {
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
      name: "Settings agent",
      permissions: options.permissions ?? settingsWrite,
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

  async function storedSettings(storeId = STORE) {
    const [row] = await louezDb.db
      .select({ settings: louezDb.stores.settings })
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, storeId));
    return row?.settings;
  }

  async function marks() {
    const { billingSyncQueue: queue, db } = louezDb;
    const rows = await db.select({ type: queue.aggregateType, id: queue.aggregateId }).from(queue);
    return rows.sort((a, b) => `${a.type}${a.id}`.localeCompare(`${b.type}${b.id}`));
  }

  async function reservation(id: string, storeId = STORE) {
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "completed",
      startDate: new Date("2026-06-01T09:00:00Z"),
      endDate: new Date("2026-06-02T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
  }

  // --- Read -----------------------------------------------------------------

  test("settings.get shows every section, with links, for a session and a key", async () => {
    const fromSession = await run("get", {}, session());
    assert.equal(fromSession.store.name, "Brest Surf");
    assert.equal(fromSession.store.latitude, 48.3904);
    assert.equal(fromSession.store.online, false);
    assert.equal(fromSession.company.currency, "EUR");
    assert.equal(fromSession.reservationRules.reservationMode, "request");
    assert.equal(fromSession.reservationRules.pendingBlocksAvailability, true);
    // A store that never saved hours takes bookings at any time.
    assert.equal(fromSession.businessHours.enabled, false);
    assert.equal(fromSession.businessHours.schedule.monday.isOpen, true);
    assert.equal(fromSession.delivery.pricePerKm, "1.50");
    assert.equal(fromSession.taxes.enabled, false);
    assert.deepEqual(fromSession.locations, []);
    assert.deepEqual(fromSession.links, {
      dashboard: `${TEST_APP_URL}/dashboard/settings?store=${STORE}`,
    });

    const key = await apiKey({ permissions: { ...settingsWrite, settings: "read" } });
    const fromKey = await run("get", {}, key());
    assert.deepEqual(fromKey, fromSession);
  });

  test("a key reads and writes its own store only", async () => {
    const other = await apiKey({ storeId: OTHER_STORE });
    assert.equal((await run("get", {}, other())).store.id, OTHER_STORE);
    await run("updateStoreInfo", { name: "Only B" }, other());
    const [a, b] = await Promise.all([
      run("get", {}, session()),
      run("get", {}, session(OWNER, OTHER_STORE)),
    ]);
    assert.equal(a.store.name, "Brest Surf");
    assert.equal(b.store.name, "Only B");
  });

  test("a member and a read-only key may read but not write", async () => {
    assert.equal((await run("get", {}, session(MEMBER))).store.id, STORE);
    await rejects(run("updateStoreInfo", { name: "No" }, session(MEMBER)), "PERMISSION_DENIED");
    const reader = await apiKey({ permissions: { ...settingsWrite, settings: "read" } });
    await rejects(run("updateTaxes", { enabled: true }, reader()), "PERMISSION_DENIED");
    const none = await apiKey({ permissions: { ...settingsWrite, settings: "none" } });
    await rejects(run("get", {}, none()), "PERMISSION_DENIED");
    // A member's key cannot do more than the member.
    const memberKey = await apiKey({ userId: MEMBER });
    await rejects(run("updateLegal", { cgv: "No" }, memberKey()), "PERMISSION_DENIED");
  });

  // --- Store info and legal -------------------------------------------------

  test("store info: a partial update, plain text kept as paragraphs, HTML sanitised", async () => {
    const key = await apiKey();
    const updated = await run(
      "updateStoreInfo",
      {
        description: "Surfboards for every level.\n\nOpen all year & every day",
        phone: "+33 2 98 00 00 00",
      },
      key(),
    );
    assert.equal(updated.store.name, "Brest Surf");
    assert.equal(updated.store.phone, "+33 2 98 00 00 00");
    assert.equal(
      updated.store.description,
      "<p>Surfboards for every level.</p><p>Open all year &amp; every day</p>",
    );
    assert.equal(updated.links.dashboard, `${TEST_APP_URL}/online-store/identity?store=${STORE}`);

    const html = await run(
      "updateStoreInfo",
      { description: '<p onclick="x()">Hi <strong>there</strong></p><script>bad()</script>' },
      key(),
    );
    assert.doesNotMatch(html.store.description ?? "", /script|onclick/);
    assert.match(html.store.description ?? "", /<strong>there<\/strong>/);

    // Saved again as it came back, then rendered by the storefront: unchanged.
    const { sanitizeRichTextHtml } = await import("@louez/utils/sanitize-rich-text");
    const entities = await run(
      "updateStoreInfo",
      { description: "Fish & chips &amp; more" },
      key(),
    );
    assert.equal(entities.store.description, "<p>Fish &amp; chips &amp; more</p>");
    const resaved = await run(
      "updateStoreInfo",
      { description: entities.store.description },
      key(),
    );
    assert.equal(resaved.store.description, entities.store.description);
    assert.equal(sanitizeRichTextHtml(resaved.store.description ?? ""), resaved.store.description);

    const cleared = await run("updateStoreInfo", { phone: null, description: "  " }, key());
    assert.equal(cleared.store.phone, null);
    assert.equal(cleared.store.description, null);
    await rejects(run("updateStoreInfo", {}, key()), "NOTHING_TO_UPDATE");
    // Name, contact and texts are in no billing snapshot.
    assert.deepEqual(await marks(), []);
    assert.deepEqual(await storedSettings(), SETTINGS);
  });

  test("legal texts: set, cleared, footer note in the settings, other sections kept", async () => {
    const key = await apiKey();
    const legal = await run(
      "updateLegal",
      {
        cgv: "Article 1.\nThe board comes back clean.",
        includeCgvInContract: true,
        footerNote: "SIRET 123",
      },
      key(),
    );
    assert.equal(legal.legal.cgv, "<p>Article 1.<br />The board comes back clean.</p>");
    assert.equal(legal.legal.includeCgvInContract, true);
    assert.equal(legal.legal.footerNote, "SIRET 123");
    assert.equal(legal.links.dashboard, `${TEST_APP_URL}/online-store/legal?store=${STORE}`);
    assert.deepEqual(await storedSettings(), { ...SETTINGS, footerNote: "SIRET 123" });

    // settings.get shows a summary unless asked for the texts.
    const summary = (await run("get", {}, key())).legal;
    assert.deepEqual(summary.cgv, { set: true, length: legal.legal.cgv?.length ?? 0 });
    assert.equal(summary.legalNotice.set, false);
    assert.equal(summary.textsIncluded, false);
    assert.ok(summary.updatedAt instanceof Date);
    const full = (await run("get", { includeLegalTexts: true }, key())).legal;
    assert.equal(full.cgv.text, legal.legal.cgv);
    assert.equal(full.legalNotice.text, null);
    assert.equal(full.textsIncluded, true);

    // An editor left with a blank paragraph shows nothing: not set, as on the storefront.
    await louezDb.db
      .update(louezDb.stores)
      .set({ legalNotice: "<p>&nbsp;</p>" })
      .where(orm.eq(louezDb.stores.id, STORE));
    assert.equal((await run("get", {}, key())).legal.legalNotice.set, false);
    assert.equal(
      (await run("updateLegal", { legalNotice: "<p>&nbsp;</p>" }, key())).legal.legalNotice,
      null,
    );

    // A link's entities stay as written, however often the text is saved again.
    const linked = await run(
      "updateLegal",
      { cgv: '<p><a href="https://x.test/?q=&amp;amp;amp;&b=1">CGV</a></p>' },
      key(),
    );
    assert.equal(
      linked.legal.cgv,
      '<p><a href="https://x.test/?q=&amp;amp;amp;&amp;b=1" rel="noopener noreferrer">CGV</a></p>',
    );
    const linkedAgain = await run("updateLegal", { cgv: linked.legal.cgv }, key());
    assert.equal(linkedAgain.legal.cgv, linked.legal.cgv);

    // Escaping can make a text longer than what was sent: past its column, it is refused.
    const tooLong = await rejects(
      run("updateLegal", { legalNotice: "&".repeat(60_000) }, key()),
      "TEXT_TOO_LONG",
    );
    assert.equal(tooLong.data.details?.maxBytes, 65_535);

    // HTML nested deeper than any editor writes is refused, as the parser reads it.
    await rejects(
      run("updateLegal", { cgv: `<!-->${"<em>".repeat(300)}x` }, key()),
      "TEXT_TOO_DEEP",
    );
    // At the limit as sent, past it once its line break is a `<br />`: refused too.
    await rejects(
      run(
        "updateLegal",
        {
          cgv: `${"<blockquote>".repeat(256)}a\nb${"</blockquote>".repeat(256)}`,
        },
        key(),
      ),
      "TEXT_TOO_DEEP",
    );
    // A text that only looks like tags is plain text, handled in one pass.
    const started = performance.now();
    const scripts = await run("updateLegal", { legalNotice: "<script ".repeat(5_000) }, key());
    assert.ok(performance.now() - started < 1_000);
    assert.match(scripts.legal.legalNotice ?? "", /^<p>&lt;script /);

    const cleared = await run("updateLegal", { cgv: null }, key());
    assert.equal(cleared.legal.cgv, null);
    assert.equal(cleared.legal.includeCgvInContract, true);
  });

  // --- Company --------------------------------------------------------------

  test("company: a session saves at once, marks the store, and the reservations on a new currency", async () => {
    await reservation("st_res_a");
    await reservation("st_res_b", OTHER_STORE);
    const updated = await run(
      "updateCompany",
      {
        country: "CH",
        currency: "CHF",
        billingAddress: {
          sameAsStore: false,
          address: "1 rue du Port",
          city: "Genève",
          postalCode: "1201",
          country: "CH",
        },
      },
      session(),
    );
    assert.equal(updated.company.timezone, "Europe/Zurich");
    assert.equal(updated.company.billingAddress.city, "Genève");
    const settings = await storedSettings();
    assert.equal(settings?.currency, "CHF");
    assert.deepEqual(settings?.inspection, SETTINGS.inspection);
    assert.deepEqual(await marks(), [
      { type: "reservation", id: "st_res_a" },
      { type: "store", id: STORE },
    ]);
    assert.deepEqual(
      events.map((event) => event.type === "store.settingsUpdated" && event.section),
      ["company"],
    );
  });

  test("company: an agent confirms a new currency; a tampered, replayed or stale token is refused", async () => {
    const key = await apiKey();
    // A code Louez does not support is refused before any preview.
    for (const currency of ["ZZZ", "BTC", "HRK"]) {
      await rejects(run("updateCompany", { currency }, key()), "CURRENCY_NOT_SUPPORTED");
    }
    await rejects(run("updateCompany", { currency: "usd" }, key()), "BAD_REQUEST");
    const input = { currency: "USD" as const };
    const refusal = await rejects(run("updateCompany", input, key()), "CONFIRMATION_REQUIRED");
    const preview = refusal.data.details?.preview as {
      summary: string;
      details: { changes: Record<string, { from: unknown; to: unknown }> };
    };
    assert.deepEqual(preview.details.changes, { currency: { from: "EUR", to: "USD" } });
    assert.equal((await storedSettings())?.currency, "EUR");
    assert.deepEqual(await marks(), []);

    const token = tokenOf(refusal);
    await rejects(
      run("updateCompany", input, key({ "louez-confirmation": `${token}x` })),
      "CONFIRMATION_INVALID",
    );
    await rejects(
      run("updateCompany", { currency: "GBP" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );
    const done = await run("updateCompany", input, key({ "louez-confirmation": token }));
    assert.equal(done.company.currency, "USD");
    // Used once.
    await rejects(
      run("updateCompany", { currency: "EUR" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );

    // The state changes between the preview and the call: the token is void.
    const second = await rejects(
      run("updateCompany", { currency: "EUR" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    await run("updateCompany", { currency: "CAD" }, session());
    await rejects(
      run("updateCompany", { currency: "EUR" }, key({ "louez-confirmation": tokenOf(second) })),
      "CONFIRMATION_INVALID",
    );

    // A billing address alone changes nothing customers pay: no confirmation.
    const address = await run("updateCompany", { billingAddress: { sameAsStore: true } }, key());
    assert.equal(address.company.billingAddress.sameAsStore, true);
  });

  test("company: a store set up in a currency Louez no longer takes keeps it while it saves the rest", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, currency: "HRK", country: "HR" } })
      .where(orm.eq(louezDb.stores.id, STORE));
    const key = await apiKey();
    // Sent back unchanged with a new address: no preview, no change of currency.
    const saved = await run(
      "updateCompany",
      {
        currency: "HRK",
        billingAddress: {
          sameAsStore: false,
          address: "Ilica 1",
          city: "Zagreb",
          postalCode: "10000",
          country: "HR",
        },
      },
      key(),
    );
    assert.equal(saved.company.currency, "HRK");
    assert.equal(saved.company.billingAddress.city, "Zagreb");
    // Leaving it is a change customers see: confirmed as usual.
    const refusal = await rejects(
      run("updateCompany", { currency: "EUR" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    await run(
      "updateCompany",
      { currency: "EUR" },
      key({ "louez-confirmation": tokenOf(refusal) }),
    );
    assert.equal((await storedSettings())?.currency, "EUR");
    // And once left, it cannot be chosen again.
    await rejects(run("updateCompany", { currency: "HRK" }, session()), "CURRENCY_NOT_SUPPORTED");
  });

  // --- Reservation rules ----------------------------------------------------

  test("rules: a partial update keeps the other rules and sections, and marks nothing", async () => {
    const key = await apiKey();
    const rules = await run(
      "updateReservationRules",
      { minRentalMinutes: 120, turnoverBufferMinutes: 30, automaticExtensions: false },
      key(),
    );
    assert.equal(rules.reservationRules.minRentalMinutes, 120);
    assert.equal(rules.reservationRules.reservationMode, "request");
    assert.equal(
      rules.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/reservations?store=${STORE}`,
    );
    const settings = await storedSettings();
    assert.equal(settings?.currency, "EUR");
    assert.deepEqual(settings?.inspection, SETTINGS.inspection);
    assert.equal(settings?.automaticExtensions, false);
    assert.deepEqual(await marks(), []);

    await rejects(
      run("updateReservationRules", { minRentalMinutes: 600, maxRentalMinutes: 60 }, key()),
      "SETTINGS_INVALID",
    );
  });

  test("rules: payment mode needs Stripe, and an agent confirms a mode change", async () => {
    const key = await apiKey();
    await rejects(
      run("updateReservationRules", { reservationMode: "payment" }, session()),
      "STRIPE_REQUIRED",
    );
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeChargesEnabled: true })
      .where(orm.eq(louezDb.stores.id, STORE));

    const input = { reservationMode: "payment" as const, onlinePaymentDepositPercentage: 30 };
    const refusal = await rejects(
      run("updateReservationRules", input, key()),
      "CONFIRMATION_REQUIRED",
    );
    const preview = refusal.data.details?.preview as { summary: string } | undefined;
    assert.match(String(preview?.summary), /paid online/);
    const done = await run(
      "updateReservationRules",
      input,
      key({ "louez-confirmation": tokenOf(refusal) }),
    );
    assert.equal(done.reservationRules.reservationMode, "payment");
    assert.equal(done.reservationRules.onlinePaymentDepositPercentage, 30);

    // The same values again change nothing customers see: no confirmation.
    await run("updateReservationRules", { ...input, advanceNoticeMinutes: 1440 }, key());
  });

  // --- Business hours -------------------------------------------------------

  test("hours: named days change, the others stay, closures get ids", async () => {
    const key = await apiKey();
    const hours = await run(
      "updateBusinessHours",
      {
        enabled: true,
        schedule: {
          monday: {
            isOpen: true,
            ranges: [
              { openTime: "09:00", closeTime: "12:00" },
              { openTime: "14:00", closeTime: "19:00" },
            ],
          },
          sunday: { isOpen: true, ranges: [{ openTime: "10:00", closeTime: "17:00" }] },
        },
        closurePeriods: [{ name: "Noël", startDate: "2026-12-24", endDate: "2026-12-26" }],
      },
      key(),
    );
    assert.equal(hours.businessHours.enabled, true);
    assert.equal(hours.businessHours.schedule.monday.ranges.length, 2);
    assert.equal(hours.businessHours.schedule.sunday.isOpen, true);
    assert.deepEqual(hours.businessHours.schedule.tuesday, {
      isOpen: true,
      ranges: [{ openTime: "09:00", closeTime: "18:00" }],
    });
    const [closure] = hours.businessHours.closurePeriods;
    assert.ok(closure?.id);
    const stored = (await storedSettings())?.businessHours;
    assert.equal(stored?.schedule[0].isOpen, true);
    assert.equal(stored?.schedule[1].ranges[1]?.closeTime, "19:00");

    const kept = await run("updateBusinessHours", { enabled: false }, key());
    assert.equal(kept.businessHours.closurePeriods[0]?.id, closure?.id);
    assert.equal(kept.businessHours.schedule.monday.ranges.length, 2);

    await rejects(
      run(
        "updateBusinessHours",
        {
          schedule: {
            friday: {
              isOpen: true,
              ranges: [
                { openTime: "09:00", closeTime: "13:00" },
                { openTime: "12:00", closeTime: "18:00" },
              ],
            },
          },
        },
        key(),
      ),
      "BAD_REQUEST",
    );
  });

  // --- Delivery and locations -----------------------------------------------

  test("delivery: needs coordinates, takes decimal strings, and an agent confirms", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ latitude: null, longitude: null })
      .where(orm.eq(louezDb.stores.id, STORE));
    await rejects(
      run("updateDelivery", { enabled: true }, session()),
      "STORE_COORDINATES_REQUIRED",
    );
    await louezDb.db
      .update(louezDb.stores)
      .set({ latitude: "48.3904000", longitude: "-4.4861000" })
      .where(orm.eq(louezDb.stores.id, STORE));

    const key = await apiKey();
    const input = {
      enabled: true,
      pricePerKm: "0.80",
      minimumFee: "5",
      freeDeliveryThreshold: "150.00",
    };
    const refusal = await rejects(run("updateDelivery", input, key()), "CONFIRMATION_REQUIRED");
    const done = await run(
      "updateDelivery",
      input,
      key({ "louez-confirmation": tokenOf(refusal) }),
    );
    assert.deepEqual(done.delivery, {
      enabled: true,
      mode: "optional",
      multiLocationEnabled: false,
      pricePerKm: "0.80",
      minimumFee: "5.00",
      maximumDistanceKm: null,
      freeDeliveryThreshold: "150.00",
      minimumOrderAmountForDelivery: null,
      currency: "EUR",
    });
    assert.equal((await storedSettings())?.delivery?.pricePerKm, 0.8);
    await rejects(run("updateDelivery", { pricePerKm: "1,5" }, key()), "BAD_REQUEST");
  });

  test("locations: create, update, hide; another store's point is not found; 50 at most", async () => {
    const key = await apiKey();
    const created = await run(
      "createLocation",
      {
        name: "Plage du Moulin Blanc",
        address: "Rue du Moulin Blanc",
        latitude: 48.39,
        longitude: -4.43,
      },
      key(),
    );
    assert.equal(created.country, "FR");
    assert.equal(created.isActive, true);
    assert.equal(
      created.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/delivery?store=${STORE}`,
    );

    const renamed = await run(
      "updateLocation",
      { id: created.id, name: "Moulin Blanc", city: "Brest" },
      key(),
    );
    assert.equal(renamed.name, "Moulin Blanc");
    assert.equal(renamed.address, "Rue du Moulin Blanc");
    assert.equal(renamed.latitude, 48.39);
    const hidden = await run("setLocationActive", { id: created.id, isActive: false }, key());
    assert.equal(hidden.isActive, false);
    assert.equal((await run("get", {}, session())).locations[0]?.id, created.id);

    const other = await apiKey({ storeId: OTHER_STORE });
    await rejects(
      run("updateLocation", { id: created.id, name: "Mine" }, other()),
      "LOCATION_NOT_FOUND",
    );
    await rejects(
      run("setLocationActive", { id: created.id, isActive: true }, other()),
      "LOCATION_NOT_FOUND",
    );

    await louezDb.db.insert(louezDb.storeLocations).values(
      Array.from({ length: 49 }, (_, index) => ({
        id: `st_loc_${String(index).padStart(14, "0")}`,
        storeId: STORE,
        name: `Point ${index}`,
        address: "Quai",
      })),
    );
    await rejects(
      run("createLocation", { name: "One more", address: "Quai" }, key()),
      "LOCATION_LIMIT_REACHED",
    );
    // The other store has its own count.
    await run("createLocation", { name: "B point", address: "Quai" }, other());
  });

  // --- Taxes ----------------------------------------------------------------

  test("taxes: a rate change marks the store's reservations; a label does not; an agent confirms", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, tax: EXCLUSIVE_20 } })
      .where(orm.eq(louezDb.stores.id, STORE));
    await reservation("st_res_taxed");
    await reservation("st_res_elsewhere", OTHER_STORE);

    await run("updateTaxes", { defaultRate: 10 }, session());
    assert.deepEqual(await marks(), [{ type: "reservation", id: "st_res_taxed" }]);

    await louezDb.db.delete(louezDb.billingSyncQueue);
    const labelled = await run("updateTaxes", { taxLabel: "VAT", taxNumber: "FR123" }, session());
    assert.equal(labelled.taxes.taxLabel, "VAT");
    assert.equal(labelled.taxes.defaultRate, 10);
    assert.deepEqual(await marks(), []);

    const key = await apiKey();
    const refusal = await rejects(
      run("updateTaxes", { displayMode: "inclusive" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    await run(
      "updateTaxes",
      { displayMode: "inclusive" },
      key({ "louez-confirmation": tokenOf(refusal) }),
    );
    assert.deepEqual(await marks(), [{ type: "reservation", id: "st_res_taxed" }]);
    const cleared = await run("updateTaxes", { taxNumber: null }, session());
    assert.equal(cleared.taxes.taxNumber, null);
  });

  // --- Concurrency and retries ----------------------------------------------

  test("two writes of different sections at once keep both changes", async () => {
    await raceOnLockedRow<unknown>(database, { table: "stores", id: STORE }, [
      () => run("updateReservationRules", { minRentalMinutes: 240 }, session()),
      () => run("updateTaxes", { enabled: true }, session()),
      () => run("updateLegal", { footerNote: "Both" }, session()),
    ]);
    const settings = await storedSettings();
    assert.equal(settings?.minRentalMinutes, 240);
    assert.equal(settings?.tax?.enabled, true);
    assert.equal(settings?.footerNote, "Both");
  });

  test("a writer outside these procedures keeps a section saved while it waited", async () => {
    // Taxes take the lock first, then the store's launch queues behind them:
    // it reads the settings once it holds the lock, so it keeps the taxes.
    const { goLive } = await import("../../services/launch");
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM `stores` WHERE id = ? FOR UPDATE", [STORE]);
      const taxes = run("updateTaxes", { enabled: true }, session());
      await waitForLockWaits(holder, database.name, 1);
      const onboarding = goLive(
        {
          storeId: STORE,
          store: { id: STORE, name: "Brest Surf", slug: "st-brest-surf", ownerUserId: OWNER },
          afterCommit: ports.afterCommit,
          userId: OWNER,
          transport: "rpc",
        },
        { reservationMode: "payment" },
        { urls: ports.urls },
      );
      await waitForLockWaits(holder, database.name, 2);
      await holder.commit();
      await Promise.all([taxes, onboarding]);
    } finally {
      await holder.end();
    }
    const settings = await storedSettings();
    assert.equal(settings?.tax?.enabled, true);
    assert.equal(settings?.reservationMode, "payment");
    assert.deepEqual(settings?.inspection, SETTINGS.inspection);
  });

  test("an idempotent retry returns the first answer without a second point", async () => {
    const key = await apiKey();
    const first = await run(
      "createLocation",
      { name: "Port", address: "Quai" },
      key({ "idempotency-key": "loc-1" }),
    );
    const replay = key({ "idempotency-key": "loc-1" });
    const second = await run("createLocation", { name: "Port", address: "Quai" }, replay);
    assert.equal(second.id, first.id);
    assert.equal(replay.receipt.replayed, true);
    assert.equal((await run("get", {}, session())).locations.length, 1);
  });
});
