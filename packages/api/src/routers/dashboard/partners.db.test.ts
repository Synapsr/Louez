import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import { eq } from "drizzle-orm";

import { lockWaitsOn } from "../../platform/test-lock-waits";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

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
          return id ? { user: { id, email: `${id}@partners.test` } } : null;
        },
      },
    },
  },
});

// Liens partenaires: a partner's link or code attributes a storefront booking
// within the store's window, the statement computes the commission from the
// reservation and its status, the store records what it paid, the partner is
// told by e-mail and reads its own space, and the store is reminded of what
// it still owes.

const OWNER = "pl_owner_user_000001";
const MEMBER = "pl_member_user_00001";
const STORE = "pl_store_a_000000001";
const OTHER_STORE = "pl_store_b_000000001";
const CUSTOMER = "pl_customer_00000001";
const NOW = new Date("2026-11-19T12:00:00Z");
const NOVEMBER = "2026-11";

describe("partner links (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let service: typeof import("../../services/partners");
  let apiKeys: typeof import("../../services/api-keys");
  let space: typeof import("../../services/partner-space");
  let router: typeof import("./partners").dashboardPartnersRouter;

  const session = (user = OWNER, extraHeaders: Record<string, string> = {}) => ({
    headers: new Headers({
      [SESSION_HEADER]: user,
      cookie: `louez_active_store=${STORE}`,
      ...extraHeaders,
    }),
    transport: "rpc" as const,
    ports: {
      planFeatures: async () => ({ apiAccess: true }),
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
      storage: {} as never,
      urls: createTestUrls(),
      afterCommit: () => {},
    },
    receipt: {} as { replayed?: boolean },
  });

  before(async () => {
    database = await createTestDatabase("api_partner_links");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    service = await import("../../services/partners");
    apiKeys = await import("../../services/api-keys");
    space = await import("../../services/partner-space");
    ({ dashboardPartnersRouter: router } = await import("./partners"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@partners.test" },
      { id: MEMBER, email: "member@partners.test" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    await db.delete(louezDb.apiEffects);
    await db.delete(louezDb.apiRateLimits);
    await db.delete(louezDb.promoCodes);
    await db.delete(louezDb.storePartnerSettings);
    await db.delete(louezDb.partnerPayouts);
    await db.delete(louezDb.partnerBookings);
    await db.delete(louezDb.storePartners);
    await db.delete(louezDb.pageViews);
    await db.delete(louezDb.reservations);
    await db.delete(louezDb.stores);
    await db.insert(louezDb.stores).values(
      [STORE, OTHER_STORE].map((id) => ({
        id,
        userId: OWNER,
        name: `Vélo Évasion ${id.slice(-1)}`,
        slug: `pl-${id}`,
        settings: {
          reservationMode: "payment" as const,
          advanceNoticeMinutes: 60,
          currency: "EUR",
          timezone: "Europe/Paris",
        },
        onboardingCompleted: true,
      })),
    );
  });

  const reservation = (
    id: string,
    values: {
      status?: "pending" | "confirmed" | "ongoing" | "completed" | "cancelled";
      endDate?: Date;
      subtotal?: string;
      discount?: string;
      insurance?: string | null;
      isTest?: boolean;
      storeId?: string;
    } = {},
  ) => ({
    id,
    storeId: values.storeId ?? STORE,
    customerId: CUSTOMER,
    // "pl_resa_done_0000001" is number "done".
    number: id.slice(8, 12),
    status: values.status ?? "completed",
    startDate: new Date("2026-11-10T08:00:00Z"),
    endDate: values.endDate ?? new Date("2026-11-12T17:00:00Z"),
    subtotalAmount: values.subtotal ?? "110.00",
    discountAmount: values.discount ?? "0.00",
    tulipInsuranceAmount: values.insurance ?? null,
    depositAmount: "300.00",
    deliveryFee: "15.00",
    totalAmount: "125.00",
    isTest: values.isTest ?? false,
  });

  const campsite = () =>
    service.createPartner(STORE, {
      name: "Camping Les Pins",
      contactEmail: "accueil@les-pins.test",
      commission: { type: "percent", value: 10 },
    });

  const CLICK = new Date("2026-11-10T09:00:00Z");

  const credit = (reservationId: string, code: string, now = NOW) =>
    service.attributeReservation({
      storeId: STORE,
      reservationId,
      code,
      origin: "link",
      clickedAt: CLICK,
      now,
    });

  const effects = () =>
    louezDb.db
      .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects)
      .orderBy(louezDb.apiEffects.seq);

  const promo = (id: string, code: string, storeId = STORE, isActive = true) =>
    louezDb.db.insert(louezDb.promoCodes).values({
      id,
      storeId,
      code,
      type: "percentage",
      value: "5.00",
      isActive,
    });

  test("a partner's code comes from its name, stays unique in the store and never changes", async () => {
    const first = await campsite();
    const second = await service.createPartner(STORE, {
      name: "Camping les Pins !",
      commission: { type: "fixed", value: 5 },
    });
    const elsewhere = await service.createPartner(OTHER_STORE, {
      name: "Camping Les Pins",
      commission: { type: "percent", value: 10 },
    });
    assert.equal(first.code, "camping-les-pins");
    assert.equal(second.code, "camping-les-pins-2");
    assert.equal(elsewhere.code, "camping-les-pins");

    const renamed = await service.updatePartner(STORE, first.id, {
      name: "Domaine des Pins",
      commission: { type: "percent", value: 12 },
    });
    assert.equal(renamed.code, "camping-les-pins");
    assert.equal(renamed.name, "Domaine des Pins");
  });

  test("a link attributes a storefront booking with the rule of that moment, once, and tells the partner", async () => {
    const partner = await campsite();
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("pl_resa_link_0000001"),
        reservation("pl_resa_test_0000001", { isTest: true }),
      ]);

    assert.equal((await credit("pl_resa_link_0000001", partner.code)).attributed, true);
    // Already attributed: the first attribution stays, nothing more is sent.
    assert.equal((await credit("pl_resa_link_0000001", partner.code)).attributed, false);
    // A test reservation is never attributed.
    assert.equal((await credit("pl_resa_test_0000001", partner.code)).attributed, false);
    assert.deepEqual(await effects(), [
      {
        type: "partner.bookingEmail",
        payload: { partnerId: partner.id, reservationId: "pl_resa_link_0000001" },
      },
    ]);

    // A rate changed afterwards leaves the booking's rule as it was.
    await service.updatePartner(STORE, partner.id, {
      name: partner.name,
      commission: { type: "percent", value: 20 },
    });
    const statement = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW);
    assert.deepEqual(
      statement.bookings.map((booking) => [booking.number, booking.origin, booking.commission]),
      [["link", "link", 11]],
    );
  });

  test("a link holds for the store's window; a code typed at checkout holds always", async () => {
    const partner = await campsite();
    await louezDb.db
      .insert(louezDb.reservations)
      .values([reservation("pl_resa_late_0000001"), reservation("pl_resa_code_0000001")]);
    assert.deepEqual(await service.getPartnerSettings(STORE), { attributionDays: 30 });

    // 40 days after the click: past the default 30.
    const later = new Date(CLICK.getTime() + 40 * 24 * 60 * 60 * 1000);
    assert.equal((await credit("pl_resa_late_0000001", partner.code, later)).attributed, false);
    assert.equal(
      await service.findCheckoutPartner({
        storeId: STORE,
        code: partner.code,
        clickedAt: CLICK,
        now: later,
      }),
      null,
    );

    await service.updatePartnerSettings(STORE, { attributionDays: 60 });
    assert.equal((await credit("pl_resa_late_0000001", partner.code, later)).attributed, true);

    const typed = await service.attributeReservation({
      storeId: STORE,
      reservationId: "pl_resa_code_0000001",
      code: partner.code,
      origin: "code",
      now: new Date("2027-06-01T00:00:00Z"),
    });
    assert.equal(typed.attributed, true);
    const origins = (await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW)).bookings
      .map((booking) => booking.origin)
      .sort();
    assert.deepEqual(origins, ["code", "link"]);
  });

  test("an unknown, archived or other store's code attributes nothing", async () => {
    const partner = await campsite();
    const other = await service.createPartner(OTHER_STORE, {
      name: "Hôtel du Port",
      commission: { type: "percent", value: 10 },
    });
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_none_0000001")]);

    assert.equal((await credit("pl_resa_none_0000001", "nobody")).attributed, false);
    assert.equal((await credit("pl_resa_none_0000001", other.code)).attributed, false);
    await service.setPartnerArchived(STORE, partner.id, true);
    assert.equal((await credit("pl_resa_none_0000001", partner.code)).attributed, false);
    assert.equal(await service.findActivePartnerByCode(STORE, partner.code), null);
    assert.deepEqual(await effects(), []);
  });

  test("the perk: one of the store's promo codes, given at checkout while it can be used", async () => {
    await promo("pl_promo_pins_000001", "PINS5");
    await promo("pl_promo_other_00001", "ELSEWHERE", OTHER_STORE);
    await assert.rejects(
      service.createPartner(STORE, {
        name: "Camping Les Pins",
        commission: { type: "percent", value: 10 },
        promoCodeId: "pl_promo_other_00001",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "PARTNER_PERK_NOT_FOUND",
    );
    const partner = await service.createPartner(STORE, {
      name: "Camping Les Pins",
      commission: { type: "percent", value: 10 },
      promoCodeId: "pl_promo_pins_000001",
    });
    assert.deepEqual(partner.perk, { promoCodeId: "pl_promo_pins_000001", code: "PINS5" });
    assert.deepEqual(
      await service.findCheckoutPartner({ storeId: STORE, code: partner.code, now: NOW }),
      {
        code: "camping-les-pins",
        name: "Camping Les Pins",
        perk: { promoCode: "PINS5", type: "percentage", value: 5, minimumAmount: 0 },
      },
    );

    await louezDb.db
      .update(louezDb.promoCodes)
      .set({ isActive: false })
      .where(eq(louezDb.promoCodes.id, "pl_promo_pins_000001"));
    assert.equal(
      (await service.findCheckoutPartner({ storeId: STORE, code: partner.code, now: NOW }))?.perk,
      null,
    );
  });

  test("the public code check: the perk as the customer sees it, never its promo code; an unknown store answers as an unknown code", async () => {
    await promo("pl_promo_pins_000001", "PINS5");
    const partner = await service.createPartner(STORE, {
      name: "Camping Les Pins",
      commission: { type: "percent", value: 10 },
      promoCodeId: "pl_promo_pins_000001",
    });
    const check = (storeId: string, code: string, ip: string) =>
      service.checkStorefrontPartnerCode({ storeId, code, ip, now: NOW });

    const found = await check(STORE, partner.code.toUpperCase(), "198.51.100.1");
    assert.deepEqual(found, {
      status: "found",
      partner: {
        name: "Camping Les Pins",
        perk: { type: "percentage", value: 5, minimumAmount: 0 },
      },
    });
    assert.doesNotMatch(JSON.stringify(found), /PINS5/);

    const unknownCode = await check(STORE, "les-sapins", "198.51.100.2");
    const unknownStore = await check("pl_store_none_000001", partner.code, "198.51.100.3");
    const notACode = await check(STORE, "?!", "198.51.100.4");
    assert.deepEqual(unknownCode, { status: "not_found" });
    assert.deepEqual(unknownStore, unknownCode);
    assert.deepEqual(notACode, unknownCode);
  });

  test("the public code check is limited per IP, then per store, whatever the answer", async () => {
    const partner = await campsite();
    const { perIp, perStore } = service.PARTNER_CODE_CHECK_LIMITS;
    assert.deepEqual(
      [perIp.max, perIp.windowMs, perStore.max, perStore.windowMs],
      [10, 15 * 60 * 1000, 120, 60 * 60 * 1000],
    );
    const check = (storeId: string, ip: string, code = partner.code, now = NOW) =>
      service.checkStorefrontPartnerCode({ storeId, code, ip, now });

    // One address: its tenth try answers, the eleventh is refused, a known code too.
    for (let attempt = 1; attempt < perIp.max; attempt += 1) {
      assert.equal((await check(STORE, "203.0.113.7", "nobody")).status, "not_found");
    }
    assert.equal((await check(STORE, "203.0.113.7")).status, "found");
    const limited = await check(STORE, "203.0.113.7");
    assert.equal(limited.status, "rate_limited");
    assert.ok(limited.status === "rate_limited" && limited.retryAfterSeconds > 0);
    // Another address still checks; the first one again once its window is over.
    assert.equal((await check(STORE, "203.0.113.8")).status, "found");
    const later = new Date(NOW.getTime() + perIp.windowMs);
    assert.equal((await check(STORE, "203.0.113.7", partner.code, later)).status, "found");

    // Many addresses on one store: its 120 tries an hour answer, then none.
    const other = await service.createPartner(OTHER_STORE, {
      name: "Hôtel du Port",
      commission: { type: "percent", value: 10 },
    });
    for (let attempt = 0; attempt < perStore.max; attempt += 1) {
      assert.equal((await check(OTHER_STORE, `192.0.2.${attempt}`, "nobody")).status, "not_found");
    }
    assert.equal((await check(OTHER_STORE, "192.0.2.200", other.code)).status, "rate_limited");
    // The other store's customers are not touched.
    assert.equal((await check(STORE, "192.0.2.201")).status, "found");
  });

  test("the statement: base without insurance or discount, due, upcoming and cancelled, by month of the rental's end", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([
      // Completed: 110 − 10 insurance − 20 discount = 80, 10 % = 8.
      reservation("pl_resa_done_0000001", { insurance: "10.00", discount: "20.00" }),
      // Confirmed and over (the store never closed it): due too.
      reservation("pl_resa_over_0000001", { status: "confirmed" }),
      // Confirmed, ends later this month: upcoming.
      reservation("pl_resa_next_0000001", {
        status: "confirmed",
        endDate: new Date("2026-11-25T17:00:00Z"),
      }),
      // Cancelled: nothing owed.
      reservation("pl_resa_void_0000001", { status: "cancelled" }),
      // Ended in October (Paris time): another month.
      reservation("pl_resa_octo_0000001", { endDate: new Date("2026-10-31T22:30:00Z") }),
    ]);
    for (const id of [
      "pl_resa_done_0000001",
      "pl_resa_over_0000001",
      "pl_resa_next_0000001",
      "pl_resa_void_0000001",
      "pl_resa_octo_0000001",
    ]) {
      await credit(id, partner.code);
    }

    const november = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW);
    assert.deepEqual(
      november.bookings.map((booking) => [
        booking.number,
        booking.base,
        booking.commission,
        booking.state,
      ]),
      [
        ["done", 80, 8, "due"],
        ["over", 110, 11, "due"],
        ["void", 110, 11, "cancelled"],
        ["next", 110, 11, "upcoming"],
      ],
    );
    assert.deepEqual(november.totals, {
      bookings: 4,
      due: 19,
      upcoming: 11,
      paid: 0,
      remaining: 19,
      visits: 0,
    });
    const october = await service.getPartnerStatement(STORE, partner.id, "2026-10", NOW);
    assert.equal(october.bookings.length, 1);
  });

  test("an adjustment replaces the rule's amount, with its reason, and can be undone", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_adjt_0000001")]);
    await credit("pl_resa_adjt_0000001", partner.code);

    await service.adjustPartnerCommission({
      storeId: STORE,
      reservationId: "pl_resa_adjt_0000001",
      amount: 5.5,
      note: "Remboursement partiel",
    });
    let [booking] = (await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW)).bookings;
    assert.deepEqual(
      [booking.computed, booking.commission, booking.adjustment],
      [11, 5.5, { amount: 5.5, note: "Remboursement partiel" }],
    );

    await service.adjustPartnerCommission({
      storeId: STORE,
      reservationId: "pl_resa_adjt_0000001",
      amount: null,
    });
    [booking] = (await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW)).bookings;
    assert.deepEqual([booking.commission, booking.adjustment], [11, null]);
  });

  test("marking a month paid records what is left and tells the partner; a later change shows the difference", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([
      reservation("pl_resa_paid_0000001"),
      reservation("pl_resa_late_0000001", {
        status: "ongoing",
        endDate: new Date("2026-11-30T17:00:00Z"),
      }),
    ]);
    for (const id of ["pl_resa_paid_0000001", "pl_resa_late_0000001"]) {
      await credit(id, partner.code);
    }
    await louezDb.db.delete(louezDb.apiEffects);

    const paid = await service.markPartnerMonthPaid({
      storeId: STORE,
      userId: OWNER,
      partnerId: partner.id,
      month: NOVEMBER,
      now: NOW,
    });
    assert.deepEqual([paid.totals.due, paid.totals.paid, paid.totals.remaining], [11, 11, 0]);
    assert.equal(paid.effectIds.length, 1);
    assert.deepEqual(
      (await effects()).map((row) => row.type),
      ["partner.payoutEmail"],
    );
    await assert.rejects(
      service.markPartnerMonthPaid({
        storeId: STORE,
        userId: OWNER,
        partnerId: partner.id,
        month: NOVEMBER,
        now: NOW,
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "PARTNER_NOTHING_TO_PAY",
    );

    // The ongoing rental ends: its commission becomes due, and is left to pay.
    const later = new Date("2026-12-01T09:00:00Z");
    const statement = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, later);
    assert.deepEqual(
      [statement.totals.due, statement.totals.paid, statement.totals.remaining],
      [22, 11, 11],
    );

    // The store is reminded of the month it still owes, once that month is over.
    assert.deepEqual(await space.readDuePartnerMonths(STORE, NOW), []);
    assert.deepEqual(
      (await space.readDuePartnerMonths(STORE, later)).map((due) => [
        due.partnerName,
        due.month,
        due.remaining,
      ]),
      [["Camping Les Pins", NOVEMBER, 11]],
    );

    // A payment recorded by mistake is removed; its e-mail then has nothing to say.
    await service.cancelPartnerPayout(STORE, statement.payouts[0].id);
    const undone = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, later);
    assert.equal(undone.totals.paid, 0);
    assert.deepEqual(await space.readPartnerPayoutNotice(partner.id, statement.payouts[0].id), {
      skipped: "payout_cancelled",
    });
  });

  /** A barrier: `wait` resolves once `open` is called. */
  function barrier() {
    let open: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  const payouts = () =>
    louezDb.db
      .select({ amount: louezDb.partnerPayouts.amount })
      .from(louezDb.partnerPayouts)
      .where(eq(louezDb.partnerPayouts.storeId, STORE));

  test("two payouts of one month at once: one is recorded and told, the other finds nothing to pay", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_race_0000001")]);
    await credit("pl_resa_race_0000001", partner.code);
    await louezDb.db.delete(louezDb.apiEffects);

    // The test holds the partner's lock, so both calls reach it before either
    // reads what is left; a real lock wait, read from InnoDB, then it lets go.
    const held = barrier();
    const release = barrier();
    const holder = louezDb.db.transaction(async (tx) => {
      await tx
        .select({ id: louezDb.storePartners.id })
        .from(louezDb.storePartners)
        .where(eq(louezDb.storePartners.id, partner.id))
        .for("update");
      held.open();
      await release.wait;
    });
    await held.wait;
    const pay = () =>
      service
        .markPartnerMonthPaid({
          storeId: STORE,
          userId: OWNER,
          partnerId: partner.id,
          month: NOVEMBER,
          now: NOW,
        })
        .then(
          (paid) => paid.totals.remaining,
          (error: { data?: { code?: string } }) => error.data?.code,
        );
    const calls = [pay(), pay()];
    try {
      await lockWaitsOn(louezDb.db, "store_partners", { count: 2 });
    } finally {
      release.open();
    }
    await holder;

    assert.deepEqual((await Promise.all(calls)).sort(), [0, "PARTNER_NOTHING_TO_PAY"].sort());
    assert.deepEqual(
      (await payouts()).map((row) => row.amount),
      ["11.00"],
    );
    assert.deepEqual(
      (await effects()).map((row) => row.type),
      ["partner.payoutEmail"],
    );
  });

  test("the same attempt sent again answers the first one, and records nothing more", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_rtry_0000001")]);
    await credit("pl_resa_rtry_0000001", partner.code);
    await louezDb.db.delete(louezDb.apiEffects);
    const input = { partnerId: partner.id, month: NOVEMBER };
    const attempt = (key: string) => session(OWNER, { "idempotency-key": key });

    const first = await orpc.call(router.markMonthPaid, input, { context: attempt("pay-nov-1") });
    const retry = attempt("pay-nov-1");
    const again = await orpc.call(router.markMonthPaid, input, { context: retry });
    assert.deepEqual(again, first);
    assert.equal(retry.receipt.replayed, true);
    assert.deepEqual([first.due, first.paid, first.remaining], [11, 11, 0]);
    assert.equal((await payouts()).length, 1);
    assert.equal((await effects()).length, 1);

    // A new attempt finds the month settled.
    await assert.rejects(
      orpc.call(router.markMonthPaid, input, { context: attempt("pay-nov-2") }),
      (error: { data?: { code?: string } }) => error.data?.code === "PARTNER_NOTHING_TO_PAY",
    );
    assert.equal((await payouts()).length, 1);
  });

  test("by hand: attribute (the partner is told), change partner (the new rule is copied), remove", async () => {
    const partner = await campsite();
    const hotel = await service.createPartner(STORE, {
      name: "Hôtel du Port",
      commission: { type: "fixed", value: 5 },
    });
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_hand_0000001")]);
    const read = () => service.getReservationPartner(STORE, "pl_resa_hand_0000001", NOW);
    const set = (partnerId: string | null) =>
      service.setReservationPartner({
        storeId: STORE,
        userId: OWNER,
        reservationId: "pl_resa_hand_0000001",
        partnerId,
      });

    assert.equal((await read()).current, null);
    assert.deepEqual(
      (await read()).options.map((option) => option.name),
      ["Camping Les Pins", "Hôtel du Port"],
    );

    assert.equal((await set(partner.id)).effectIds.length, 1);
    assert.deepEqual((await read()).current, {
      partnerId: partner.id,
      name: "Camping Les Pins",
      origin: "manual",
      commission: 11,
      state: "due",
    });
    // The same partner again changes nothing and tells no one.
    assert.equal((await set(partner.id)).effectIds.length, 0);

    await set(hotel.id);
    assert.equal((await read()).current?.commission, 5);

    await set(null);
    assert.equal((await read()).current, null);
  });

  test("visits count the sessions that carried the partner, in the month, for this store", async () => {
    const partner = await campsite();
    const view = (
      sessionId: string,
      createdAt: Date,
      storeId = STORE,
      partnerId: string | null = partner.id,
    ) => ({ storeId, sessionId, page: "home" as const, partnerId, createdAt });
    await louezDb.db
      .insert(louezDb.pageViews)
      .values([
        view("00000000-0000-4000-8000-000000000001", new Date("2026-11-05T10:00:00Z")),
        view("00000000-0000-4000-8000-000000000001", new Date("2026-11-05T10:01:00Z")),
        view("00000000-0000-4000-8000-000000000002", new Date("2026-11-06T10:00:00Z")),
        view("00000000-0000-4000-8000-000000000003", new Date("2026-11-06T10:00:00Z"), STORE, null),
        view("00000000-0000-4000-8000-000000000004", new Date("2026-10-06T10:00:00Z")),
        view("00000000-0000-4000-8000-000000000005", new Date("2026-11-06T10:00:00Z"), OTHER_STORE),
      ]);
    const list = await service.listPartners(STORE, NOVEMBER, NOW);
    assert.equal(list.partners[0].totals.visits, 2);
  });

  test("the partner's space: found by its secret, nothing about customers, its own e-mail settings, a new secret ends the old one", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([
      reservation("pl_resa_publ_0000001"),
      reservation("pl_resa_soon_0000001", {
        status: "confirmed",
        endDate: new Date("2026-11-28T17:00:00Z"),
      }),
    ]);
    await credit("pl_resa_publ_0000001", partner.code);
    await credit("pl_resa_soon_0000001", partner.code);
    const statementToken = await service.getPartnerSpaceToken(STORE, partner.id);

    const page = await space.getPartnerSpace(statementToken, NOVEMBER, NOW);
    assert.ok(page);
    assert.equal(page.partner.name, "Camping Les Pins");
    assert.deepEqual(page.overview, { upcoming: 11, toReceive: 11, received: 0, bookings: 2 });
    assert.equal(page.activity.length, 2);
    assert.deepEqual(Object.keys(page.bookings[0]).sort(), ["commission", "endDate", "state"]);
    const serialized = JSON.stringify(page);
    for (const leak of ["pl_resa", "publ", "110", "@partners.test"]) {
      assert.equal(serialized.includes(leak), false, leak);
    }
    // The contact e-mail the store gave is where its e-mails go, until it sets another.
    assert.equal(page.notifications.email, "accueil@les-pins.test");

    assert.equal(
      await space.updatePartnerNotifications(statementToken, {
        email: "compta@les-pins.test",
        bookings: false,
        payouts: true,
        statements: true,
      }),
      true,
    );
    assert.deepEqual(
      await space.readPartnerBookingNotice(partner.id, "pl_resa_publ_0000001", NOW),
      { skipped: "partner_opted_out" },
    );
    const notified = await space.getPartnerSpace(statementToken, NOVEMBER, NOW);
    assert.equal(notified?.notifications.email, "compta@les-pins.test");

    await service.rotatePartnerStatementToken(STORE, partner.id);
    assert.equal(await space.getPartnerSpace(statementToken, NOVEMBER, NOW), null);
    assert.equal(await space.getPartnerSpace("not-a-token", NOVEMBER, NOW), null);
    assert.equal(
      await space.updatePartnerNotifications(statementToken, {
        email: null,
        bookings: true,
        payouts: true,
        statements: true,
      }),
      false,
    );
  });

  test("the space's link: in no statement read, only from the dashboard's action, to a manager", async () => {
    const partner = await campsite();
    const token = await service.getPartnerSpaceToken(STORE, partner.id);
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Agent comptable",
      permissions: {
        reservations: "read",
        products: "read",
        customers: "read",
        categories: "read",
        payments: "read",
        analytics: "read",
        settings: "read",
        online_store: "read",
      },
    });
    const key = {
      ...session(),
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "openapi" as const,
    };
    const input = { partnerId: partner.id, month: NOVEMBER };

    // An API key reads the statement (as MCP, OAuth and the assistant do), never the secret.
    const read = await orpc.call(router.getStatement, input, { context: key });
    assert.equal(read.partner.id, partner.id);
    assert.equal(JSON.stringify(read).includes(token), false);
    const dashboardRead = await orpc.call(router.getStatement, input, { context: session() });
    assert.equal(JSON.stringify(dashboardRead).includes(token), false);

    // The dashboard's own action gives the owner the link…
    assert.deepEqual(
      await orpc.call(router.getSpaceLink, { partnerId: partner.id }, { context: session() }),
      { url: `${new URL(createTestUrls().dashboard("/")).origin}/partner/${token}` },
    );
    // …never a key or the assistant, though it acts with the owner's session.
    for (const context of [key, { ...session(), assistant: true }]) {
      await assert.rejects(
        orpc.call(router.getSpaceLink, { partnerId: partner.id }, { context }),
        (error: { data?: { code?: string } }) => error.data?.code === "SESSION_ONLY",
      );
    }
  });

  test("a credited booking's e-mail reads the booking when it goes out", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_mail_0000001")]);
    await credit("pl_resa_mail_0000001", partner.code);
    const notice = await space.readPartnerBookingNotice(partner.id, "pl_resa_mail_0000001", NOW);
    assert.ok(!("skipped" in notice));
    assert.equal(notice.to, "accueil@les-pins.test");
    assert.equal(notice.booking.commission, 11);
    // Taken away from the partner since: nothing to say.
    await service.setReservationPartner({
      storeId: STORE,
      userId: OWNER,
      reservationId: "pl_resa_mail_0000001",
      partnerId: null,
    });
    assert.deepEqual(
      await space.readPartnerBookingNotice(partner.id, "pl_resa_mail_0000001", NOW),
      { skipped: "booking_not_partner" },
    );
  });

  test("the monthly statement is queued once per month, for a partner with bookings ending in it", async () => {
    const partner = await campsite();
    const quiet = await service.createPartner(STORE, {
      name: "Hôtel du Port",
      contactEmail: "hotel@port.test",
      commission: { type: "fixed", value: 5 },
    });
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("pl_resa_mnth_0000001"),
        reservation("pl_resa_dece_0000001", { endDate: new Date("2026-12-20T17:00:00Z") }),
      ]);
    await credit("pl_resa_mnth_0000001", partner.code);
    // The hotel's only booking ends in December: no November statement for it.
    await service.attributeReservation({
      storeId: STORE,
      reservationId: "pl_resa_dece_0000001",
      code: quiet.code,
      origin: "code",
    });
    await louezDb.db.delete(louezDb.apiEffects);

    const december = new Date("2026-12-02T08:00:00Z");
    assert.equal((await space.queueMonthlyPartnerStatements(december)).length, 1);
    assert.deepEqual(await effects(), [
      { type: "partner.statementEmail", payload: { partnerId: partner.id, month: NOVEMBER } },
    ]);
    // Again the same month: nothing more.
    assert.equal((await space.queueMonthlyPartnerStatements(december)).length, 0);

    const notice = await space.readPartnerStatementNotice(partner.id, NOVEMBER, december);
    assert.ok(!("skipped" in notice));
    assert.deepEqual([notice.totals.bookings, notice.totals.due], [1, 11]);
  });

  test("a demo store's partners get no monthly statement", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values(reservation("pl_resa_demo_0000001"));
    await credit("pl_resa_demo_0000001", partner.code);
    await louezDb.db.delete(louezDb.apiEffects);
    await louezDb.db
      .update(louezDb.stores)
      .set({ demoVertical: "velo" })
      .where(eq(louezDb.stores.id, STORE));
    try {
      assert.deepEqual(
        await space.queueMonthlyPartnerStatements(new Date("2026-12-02T08:00:00Z")),
        [],
      );
      assert.deepEqual(await effects(), []);
    } finally {
      await louezDb.db
        .update(louezDb.stores)
        .set({ demoVertical: null })
        .where(eq(louezDb.stores.id, STORE));
    }
  });

  // Every partner write needs `manage_settings`, as the store's promo codes
  // do, and so does the link to a partner's space: a member with only `write`
  // is refused, the owner's same call goes through.
  const managerOnly: {
    write: keyof typeof router;
    input: (fixture: { partnerId: string; payoutId: string }) => unknown;
  }[] = [
    {
      write: "create",
      input: () => ({ name: "Office de tourisme", commission: { type: "percent", value: 8 } }),
    },
    {
      write: "update",
      input: ({ partnerId }) => ({
        partnerId,
        name: "Camping Les Pins",
        commission: { type: "percent", value: 12 },
      }),
    },
    { write: "setArchived", input: ({ partnerId }) => ({ partnerId, archived: true }) },
    { write: "updateSettings", input: () => ({ attributionDays: 14 }) },
    { write: "getSpaceLink", input: ({ partnerId }) => ({ partnerId }) },
    { write: "rotateStatementToken", input: ({ partnerId }) => ({ partnerId }) },
    { write: "markMonthPaid", input: ({ partnerId }) => ({ partnerId, month: NOVEMBER }) },
    { write: "cancelPayout", input: ({ payoutId }) => ({ payoutId }) },
    {
      write: "adjustCommission",
      input: () => ({ reservationId: "pl_resa_rght_0000001", amount: 5, note: "Geste" }),
    },
    {
      write: "setForReservation",
      input: () => ({ reservationId: "pl_resa_rght_0000001", partnerId: null }),
    },
  ];

  for (const { write, input } of managerOnly) {
    test(`${write}: a member without manage_settings is refused, the owner is not`, async () => {
      const partner = await campsite();
      await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_rght_0000001")]);
      await credit("pl_resa_rght_0000001", partner.code);
      // A month left to pay, and a payout recorded earlier to cancel.
      await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_rgh2_0000001")]);
      await credit("pl_resa_rgh2_0000001", partner.code);
      const [payout] = await louezDb.db
        .insert(louezDb.partnerPayouts)
        .values({
          storeId: STORE,
          partnerId: partner.id,
          month: NOVEMBER,
          amount: "11.00",
          currency: "EUR",
          userId: OWNER,
        })
        .$returningId();
      const procedure = router[write] as Parameters<typeof orpc.call>[0];
      const args = input({ partnerId: partner.id, payoutId: payout.id });

      await assert.rejects(
        orpc.call(procedure, args, { context: session(MEMBER) }),
        (error: { data?: { code?: string } }) => error.data?.code === "PERMISSION_DENIED",
      );
      await orpc.call(procedure, args, { context: session() });
    });
  }

  test("procedures stay in the session's store, and give their links", async () => {
    const created = await orpc.call(
      router.create,
      { name: "Office de tourisme", commission: { type: "percent", value: 8 } },
      { context: session() },
    );
    const list = await orpc.call(router.list, { month: NOVEMBER }, { context: session() });
    assert.deepEqual(
      list.partners.map((partner) => partner.name),
      ["Office de tourisme"],
    );
    assert.match(list.links.dashboard ?? "", /\/dashboard\/visibility\/partners\?store=/);

    const settings = await orpc.call(
      router.updateSettings,
      { attributionDays: 14 },
      { context: session() },
    );
    assert.deepEqual(settings, { attributionDays: 14 });
    await assert.rejects(
      orpc.call(router.updateSettings, { attributionDays: 15 }, { context: session() }),
    );

    const foreign = await service.createPartner(OTHER_STORE, {
      name: "Ailleurs",
      commission: { type: "percent", value: 8 },
    });
    await assert.rejects(
      orpc.call(router.getStatement, { partnerId: foreign.id }, { context: session() }),
      (error: { data?: { code?: string } }) => error.data?.code === "PARTNER_NOT_FOUND",
    );
    await louezDb.db
      .insert(louezDb.reservations)
      .values([reservation("pl_resa_frgn_0000001", { storeId: OTHER_STORE })]);
    await assert.rejects(
      orpc.call(
        router.setForReservation,
        { reservationId: "pl_resa_frgn_0000001", partnerId: created.id },
        { context: session() },
      ),
      (error: { data?: { code?: string } }) => error.data?.code === "RESERVATION_NOT_FOUND",
    );
  });
});
