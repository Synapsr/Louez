import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import { eq } from "drizzle-orm";

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
  let space: typeof import("../../services/partner-space");
  let router: typeof import("./partners").dashboardPartnersRouter;

  const session = () => ({
    headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
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
    receipt: {},
  });

  before(async () => {
    database = await createTestDatabase("api_partner_links");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    service = await import("../../services/partners");
    space = await import("../../services/partner-space");
    ({ dashboardPartnersRouter: router } = await import("./partners"));

    await louezDb.db.insert(louezDb.users).values([{ id: OWNER, email: "owner@partners.test" }]);
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values([{ storeId: STORE, userId: OWNER, role: "owner" }]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    await db.delete(louezDb.apiEffects);
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
        perkCode: "PINS5",
      },
    );

    await louezDb.db
      .update(louezDb.promoCodes)
      .set({ isActive: false })
      .where(eq(louezDb.promoCodes.id, "pl_promo_pins_000001"));
    assert.equal(
      (await service.findCheckoutPartner({ storeId: STORE, code: partner.code, now: NOW }))
        ?.perkCode,
      null,
    );
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
    const { statementToken } = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW);

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
