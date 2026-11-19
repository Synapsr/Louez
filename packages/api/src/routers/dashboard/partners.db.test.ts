import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

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

// Liens partenaires: a partner's link attributes a storefront booking, the
// statement computes the commission from the reservation and its status,
// and the store records what it paid.

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

  test("a link attributes a storefront booking with the rule of that moment, once", async () => {
    const partner = await campsite();
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("pl_resa_link_0000001"),
        reservation("pl_resa_test_0000001", { isTest: true }),
      ]);

    assert.equal(
      await service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: "pl_resa_link_0000001",
        code: partner.code,
      }),
      true,
    );
    // Already attributed: the first attribution stays.
    assert.equal(
      await service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: "pl_resa_link_0000001",
        code: partner.code,
      }),
      false,
    );
    // A test reservation is never attributed.
    assert.equal(
      await service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: "pl_resa_test_0000001",
        code: partner.code,
      }),
      false,
    );
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

  test("an unknown, archived or other store's code attributes nothing", async () => {
    const partner = await campsite();
    const other = await service.createPartner(OTHER_STORE, {
      name: "Hôtel du Port",
      commission: { type: "percent", value: 10 },
    });
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_none_0000001")]);
    const attribute = (code: string) =>
      service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: "pl_resa_none_0000001",
        code,
      });

    assert.equal(await attribute("nobody"), false);
    assert.equal(await attribute(other.code), false);
    await service.setPartnerArchived(STORE, partner.id, true);
    assert.equal(await attribute(partner.code), false);
    assert.equal(await service.findActivePartnerByCode(STORE, partner.code), null);
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
      await service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: id,
        code: partner.code,
      });
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
    await service.attributeReservationFromLink({
      storeId: STORE,
      reservationId: "pl_resa_adjt_0000001",
      code: partner.code,
    });

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
      note: null,
    });
    [booking] = (await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW)).bookings;
    assert.deepEqual([booking.commission, booking.adjustment], [11, null]);
  });

  test("marking a month paid records what is left; a later change shows the difference", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([
      reservation("pl_resa_paid_0000001"),
      reservation("pl_resa_late_0000001", {
        status: "ongoing",
        endDate: new Date("2026-11-30T17:00:00Z"),
      }),
    ]);
    for (const id of ["pl_resa_paid_0000001", "pl_resa_late_0000001"]) {
      await service.attributeReservationFromLink({
        storeId: STORE,
        reservationId: id,
        code: partner.code,
      });
    }

    const paid = await service.markPartnerMonthPaid({
      storeId: STORE,
      userId: OWNER,
      partnerId: partner.id,
      month: NOVEMBER,
      now: NOW,
    });
    assert.deepEqual([paid.due, paid.paid, paid.remaining], [11, 11, 0]);
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

    // A payment recorded by mistake is removed.
    await service.cancelPartnerPayout(STORE, statement.payouts[0].id);
    const undone = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, later);
    assert.equal(undone.totals.paid, 0);
  });

  test("by hand: attribute, change partner (the new rule is copied), remove", async () => {
    const partner = await campsite();
    const hotel = await service.createPartner(STORE, {
      name: "Hôtel du Port",
      commission: { type: "fixed", value: 5 },
    });
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_hand_0000001")]);
    const read = () => service.getReservationPartner(STORE, "pl_resa_hand_0000001", NOW);

    assert.equal((await read()).current, null);
    assert.deepEqual(
      (await read()).options.map((option) => option.name),
      ["Camping Les Pins", "Hôtel du Port"],
    );

    await service.setReservationPartner({
      storeId: STORE,
      userId: OWNER,
      reservationId: "pl_resa_hand_0000001",
      partnerId: partner.id,
    });
    assert.deepEqual((await read()).current, {
      partnerId: partner.id,
      name: "Camping Les Pins",
      origin: "manual",
      commission: 11,
      state: "due",
    });

    await service.setReservationPartner({
      storeId: STORE,
      userId: OWNER,
      reservationId: "pl_resa_hand_0000001",
      partnerId: hotel.id,
    });
    assert.equal((await read()).current?.commission, 5);

    await service.setReservationPartner({
      storeId: STORE,
      userId: OWNER,
      reservationId: "pl_resa_hand_0000001",
      partnerId: null,
    });
    assert.equal((await read()).current, null);
  });

  test("visits count the sessions that carried the partner, in the month, for this store", async () => {
    const partner = await campsite();
    const view = (
      sessionId: string,
      createdAt: Date,
      storeId = STORE,
      partnerId: string | null = partner.id,
    ) => ({
      storeId,
      sessionId,
      page: "home" as const,
      partnerId,
      createdAt,
    });
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

  test("the partner's page: found by its secret, no reservation number, a new secret ends the old one", async () => {
    const partner = await campsite();
    await louezDb.db.insert(louezDb.reservations).values([reservation("pl_resa_publ_0000001")]);
    await service.attributeReservationFromLink({
      storeId: STORE,
      reservationId: "pl_resa_publ_0000001",
      code: partner.code,
    });
    const { statementToken } = await service.getPartnerStatement(STORE, partner.id, NOVEMBER, NOW);

    const page = await service.getPublicPartnerStatement(statementToken, NOVEMBER, NOW);
    assert.ok(page);
    assert.equal(page.partnerName, "Camping Les Pins");
    assert.equal(page.totals.due, 11);
    assert.deepEqual(Object.keys(page.bookings[0]).sort(), ["commission", "endDate", "state"]);
    assert.equal(JSON.stringify(page).includes("pl_resa_publ"), false);

    await service.rotatePartnerStatementToken(STORE, partner.id);
    assert.equal(await service.getPublicPartnerStatement(statementToken, NOVEMBER, NOW), null);
    assert.equal(await service.getPublicPartnerStatement("not-a-token", NOVEMBER, NOW), null);
  });

  test("procedures stay in the session's store", async () => {
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
