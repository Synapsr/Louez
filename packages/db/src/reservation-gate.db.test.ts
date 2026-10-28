import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { RESERVATION_ACTORS, type ReservationActor, type ReservationStatus } from "./reservation-status";
import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// The card gate (louez-billing docs/api, README §8.4 and §8.5) in the real helpers, on
// a migrated database. M2's policies all allow reservations, so the open cases are what
// production sees; the closed ones use blocking policies, which the service does not
// issue before M3.

const NEW_STORES_FROM = "2027-01-25T00:00:00Z";
const NOW = new Date("2027-02-01T10:00:00Z");
const ENV_NAMES = [
  "LOUEZ_BILLING",
  "BILLING_SERVICE_URL",
  "BILLING_NEW_STORES_FROM",
  "BILLING_GATE_DISABLED",
] as const;

/** A store created before the cutoff with no version of its own: legacy. */
const LEGACY = "gate_legacy";
/** A store created before the cutoff with its own louez_legacy version, as P4 issues them. */
const ALLOWED = "gate_allowed";
/** A store whose own version refuses reservations. */
const BLOCKED = "gate_blocked";
/** A store created after the cutoff that no version covers: it fails closed. */
const NEW_STORE = "gate_new";
/** A store with a block scheduled for 2027-02-10, then a later version that allows. */
const SCHEDULED = "gate_scheduled";

function policy(
  storeId: string,
  version: number,
  effectiveFrom: string,
  reservations: { allowed: true } | { allowed: false; reason: string },
) {
  return {
    schema: "louez.billing.policy/1",
    storeId,
    version,
    effectiveFrom,
    issuedAt: "2026-11-20T10:00:00Z",
    newStoresCreatedFrom: null,
    offerKey: "test-legacy",
    invoicing: "louez_legacy",
    currency: "EUR",
    applicationFee: { kind: "per_reservation", amountMinor: 90 },
    marketplaceFeeMinor: 150,
    reservations,
    notice: null,
    stripeCustomerId: null,
    labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
  };
}

const POLICIES = [
  policy(ALLOWED, 1, "2026-12-01T00:00:00Z", { allowed: true }),
  policy(BLOCKED, 1, "2026-12-01T00:00:00Z", { allowed: true }),
  policy(BLOCKED, 2, "2027-01-05T00:00:00Z", { allowed: false, reason: "payment_overdue" }),
  policy(SCHEDULED, 1, "2026-12-01T00:00:00Z", { allowed: true }),
  policy(SCHEDULED, 2, "2027-02-10T00:00:00Z", { allowed: false, reason: "suspended" }),
];

describe("card gate (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");
  const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("reservation_gate");
    // DATABASE_URL now points at the test database.
    louezDb = await import("./index");
    await louezDb.db.insert(louezDb.stores).values([
      store(LEGACY, "2026-05-01T00:00:00Z"),
      store(ALLOWED, "2026-05-01T00:00:00Z"),
      store(BLOCKED, "2026-05-01T00:00:00Z"),
      store(NEW_STORE, "2027-01-30T00:00:00Z"),
      store(SCHEDULED, "2026-05-01T00:00:00Z"),
    ]);
    await louezDb.db.insert(louezDb.billingPolicies).values(
      POLICIES.map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
  });

  after(async () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** Service mode, as production runs it from the M1 release on. */
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
    delete process.env.BILLING_GATE_DISABLED;
  });
  afterEach(() => {
    delete process.env.BILLING_GATE_DISABLED;
  });

  function store(id: string, createdAt: string) {
    return {
      id,
      userId: `user_${id}`,
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    };
  }

  const nextId = () => `gate_res_${++counter}`;

  function insert(storeId: string, status: "pending" | "quote" | "confirmed", now = NOW) {
    const id = nextId();
    return {
      id,
      run: () =>
        louezDb.db.transaction((tx) =>
          louezDb.insertReservation(
            tx,
            {
              id,
              storeId,
              customerId: "customer",
              number: id,
              status,
              source: "manual",
              startDate: new Date("2027-03-01T09:00:00Z"),
              endDate: new Date("2027-03-03T09:00:00Z"),
              subtotalAmount: "10.00",
              depositAmount: "0.00",
              totalAmount: "10.00",
            },
            { now },
          ),
        ),
    };
  }

  /** A reservation fixture in any status, written outside the helpers. */
  async function fixture(storeId: string, status: ReservationStatus): Promise<string> {
    const id = nextId();
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status,
      startDate: new Date("2027-03-01T09:00:00Z"),
      endDate: new Date("2027-03-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source: "online",
      billableAt: louezDb.isBillableReservationStatus(status) ? NOW : null,
    });
    return id;
  }

  const change = (
    storeId: string,
    reservationId: string,
    to: ReservationStatus,
    actor: ReservationActor = "store_user",
    now = NOW,
  ) =>
    louezDb.db.transaction((tx) =>
      louezDb.changeReservationStatus(tx, {
        reservationId,
        storeId,
        to,
        actor,
        actorUserId: null,
        now,
      }),
    );

  async function readStatus(id: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status, billableAt: louezDb.reservations.billableAt })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row ?? null;
  }

  async function activityCount(id: string) {
    const rows = await louezDb.db
      .select({ id: louezDb.reservationActivity.id })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    return rows.length;
  }

  async function queueRow(id: string) {
    const rows = await louezDb.db
      .select({ id: louezDb.billingSyncQueue.aggregateId })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.aggregateId, id));
    return rows.length;
  }

  const refusal = (reason: string) => (error: unknown) => {
    assert.ok(louezDb.isStoreNotAcceptingReservationsError(error));
    assert.equal(error.code, "store_not_accepting_reservations");
    assert.equal(error.reason, reason);
    return true;
  };

  test("allowed: a store's own version that allows reservations, M2's only shape, changes no path", async () => {
    assert.deepEqual(await louezDb.readReservationGate(louezDb.db, ALLOWED, NOW), {
      accepts: true,
    });
    const created = insert(ALLOWED, "confirmed");
    assert.equal((await created.run()).effects.length, 1);
    assert.equal((await readStatus(created.id))?.status, "confirmed");

    for (const [from, actor] of [
      ["pending", "store_user"],
      ["quote", "customer"],
      ["pending", "ai_chat"],
      ["pending", "mcp"],
    ] as const) {
      const id = await fixture(ALLOWED, from);
      const result = await change(ALLOWED, id, "confirmed", actor);
      assert.equal(result.changed, true);
    }
  });

  test("legacy: a store created before the cutoff with no version of its own is open", async () => {
    assert.deepEqual(await louezDb.readReservationGate(louezDb.db, LEGACY, NOW), {
      accepts: true,
    });
    const created = insert(LEGACY, "confirmed");
    await created.run();
    assert.equal((await readStatus(created.id))?.status, "confirmed");
    const id = await fixture(LEGACY, "pending");
    assert.equal((await change(LEGACY, id, "confirmed")).changed, true);
  });

  test("blocked: a booking created as confirmed is refused before anything is written", async () => {
    const created = insert(BLOCKED, "confirmed");
    await assert.rejects(created.run(), refusal("payment_overdue"));
    assert.equal(await readStatus(created.id), null);
    // The mark rolled back with the insert.
    assert.equal(await queueRow(created.id), 0);
  });

  test("blocked: every change into the billable set is refused, unless a payment confirms it", async () => {
    for (const actor of RESERVATION_ACTORS) {
      for (const from of ["pending", "quote"] as const) {
        const id = await fixture(BLOCKED, from);
        if (actor === "payment") {
          // The renter already paid.
          assert.equal((await change(BLOCKED, id, "confirmed", actor)).changed, true);
          assert.equal((await readStatus(id))?.status, "confirmed");
          continue;
        }
        await assert.rejects(change(BLOCKED, id, "confirmed", actor), refusal("payment_overdue"));
        assert.deepEqual(await readStatus(id), { status: from, billableAt: null });
        assert.equal(await activityCount(id), 0);
      }
    }
  });

  test("blocked: drafts, quotes, cancellations and confirmed → ongoing → completed go through", async () => {
    for (const status of ["pending", "quote"] as const) {
      const created = insert(BLOCKED, status);
      await created.run();
      assert.equal((await readStatus(created.id))?.status, status);
    }

    const rental = await fixture(BLOCKED, "confirmed");
    assert.equal((await change(BLOCKED, rental, "ongoing")).changed, true);
    assert.equal((await change(BLOCKED, rental, "completed")).changed, true);

    for (const [from, to] of [
      ["pending", "cancelled"],
      ["pending", "rejected"],
      ["quote", "declined"],
      ["confirmed", "cancelled"],
    ] as const) {
      const id = await fixture(BLOCKED, from);
      assert.equal((await change(BLOCKED, id, to)).changed, true);
    }
  });

  test("fail closed: a new store that no version covers is refused", async () => {
    assert.deepEqual(await louezDb.readReservationGate(louezDb.db, NEW_STORE, NOW), {
      accepts: false,
      reason: "payment_method_required",
    });
    const created = insert(NEW_STORE, "confirmed");
    await assert.rejects(created.run(), refusal("payment_method_required"));
    const id = await fixture(NEW_STORE, "pending");
    await assert.rejects(change(NEW_STORE, id, "confirmed"), refusal("payment_method_required"));
  });

  test("disabled: BILLING_GATE_DISABLED=true opens a closed gate", async () => {
    process.env.BILLING_GATE_DISABLED = "true";
    for (const storeId of [BLOCKED, NEW_STORE]) {
      assert.deepEqual(await louezDb.readReservationGate(louezDb.db, storeId, NOW), {
        accepts: true,
      });
      const created = insert(storeId, "confirmed");
      await created.run();
      assert.equal((await readStatus(created.id))?.status, "confirmed");
      const id = await fixture(storeId, "pending");
      assert.equal((await change(storeId, id, "confirmed")).changed, true);
    }
    assert.deepEqual(
      await louezDb.readStoresNotAcceptingReservations(louezDb.db, [BLOCKED, NEW_STORE], NOW),
      new Set(),
    );
  });

  test("a scheduled block closes the gate at its effectiveFrom, and a higher version reopens it", async () => {
    const before = new Date("2027-02-09T23:59:59Z");
    const after = new Date("2027-02-10T00:00:00Z");
    assert.equal((await louezDb.readReservationGate(louezDb.db, SCHEDULED, before)).accepts, true);
    assert.deepEqual(await louezDb.readReservationGate(louezDb.db, SCHEDULED, after), {
      accepts: false,
      reason: "suspended",
    });
    const id = await fixture(SCHEDULED, "pending");
    await assert.rejects(
      change(SCHEDULED, id, "confirmed", "store_user", after),
      refusal("suspended"),
    );

    // A card added on day 3: v3 allows, effective at once, and outranks the block (policy-03).
    const v3 = policy(SCHEDULED, 3, "2027-02-03T00:00:00Z", { allowed: true });
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: SCHEDULED,
      version: 3,
      effectiveFrom: new Date(v3.effectiveFrom),
      body: v3,
    });
    assert.equal((await louezDb.readReservationGate(louezDb.db, SCHEDULED, after)).accepts, true);
    assert.equal((await change(SCHEDULED, id, "confirmed", "store_user", after)).changed, true);
  });

  test("the feed reads the closed stores of a page in one pass", async () => {
    assert.deepEqual(
      await louezDb.readStoresNotAcceptingReservations(
        louezDb.db,
        [LEGACY, ALLOWED, BLOCKED, NEW_STORE, "gate_missing"],
        NOW,
      ),
      new Set([BLOCKED, NEW_STORE]),
    );
  });

  test("`*` versions: their cutoff makes a store new, and the one in force decides, in both reads", async () => {
    // Created after a `*` cutoff and before BILLING_NEW_STORES_FROM: new through `*` only.
    const between = "gate_between";
    await louezDb.db.insert(louezDb.stores).values(store(between, "2027-01-15T00:00:00Z"));
    const cutoff = "2027-01-10T00:00:00Z";
    const defaults = (version: number, reservations: Parameters<typeof policy>[3]) => ({
      ...policy("*", version, cutoff, reservations),
      newStoresCreatedFrom: cutoff,
    });
    const page = [LEGACY, ALLOWED, BLOCKED, NEW_STORE, between];
    const closedOneByOne = async () => {
      const closed = new Set<string>();
      for (const storeId of page) {
        if (!(await louezDb.readReservationGate(louezDb.db, storeId, NOW)).accepts) {
          closed.add(storeId);
        }
      }
      return closed;
    };
    try {
      // README §8.3's fail-closed default: a new store needs a card.
      const refusing = defaults(1, { allowed: false, reason: "payment_method_required" });
      await louezDb.db.insert(louezDb.billingPolicies).values({
        storeId: "*",
        version: 1,
        effectiveFrom: new Date(cutoff),
        body: refusing,
      });
      const closed = new Set([BLOCKED, NEW_STORE, between]);
      assert.deepEqual(await closedOneByOne(), closed);
      assert.deepEqual(
        await louezDb.readStoresNotAcceptingReservations(louezDb.db, page, NOW),
        closed,
      );
      await assert.rejects(insert(between, "confirmed").run(), refusal("payment_method_required"));

      // v2 allows, from the same instant, and outranks v1.
      const allowing = defaults(2, { allowed: true });
      await louezDb.db.insert(louezDb.billingPolicies).values({
        storeId: "*",
        version: 2,
        effectiveFrom: new Date(cutoff),
        body: allowing,
      });
      assert.deepEqual(await closedOneByOne(), new Set([BLOCKED]));
      assert.deepEqual(
        await louezDb.readStoresNotAcceptingReservations(louezDb.db, page, NOW),
        new Set([BLOCKED]),
      );
      const created = insert(between, "confirmed");
      await created.run();
      assert.equal((await readStatus(created.id))?.status, "confirmed");
    } finally {
      await louezDb.db
        .delete(louezDb.billingPolicies)
        .where(eq(louezDb.billingPolicies.storeId, "*"));
    }
  });

  test("self-hosted and cloud without the service: the gate is open and the policy table is never read", async () => {
    // With the table gone, any read of it would throw.
    await louezDb.db.execute(sql`RENAME TABLE billing_policies TO billing_policies_hidden`);
    try {
      for (const mode of [{}, { LOUEZ_BILLING: "off" }, { LOUEZ_BILLING: "cloud" }]) {
        delete process.env.LOUEZ_BILLING;
        delete process.env.BILLING_SERVICE_URL;
        Object.assign(process.env, mode);

        for (const storeId of [BLOCKED, NEW_STORE]) {
          assert.deepEqual(await louezDb.readReservationGate(louezDb.db, storeId, NOW), {
            accepts: true,
          });
          const created = insert(storeId, "confirmed");
          await created.run();
          assert.equal((await readStatus(created.id))?.status, "confirmed");
          const id = await fixture(storeId, "pending");
          assert.equal((await change(storeId, id, "confirmed")).changed, true);
        }
        assert.deepEqual(
          await louezDb.readStoresNotAcceptingReservations(louezDb.db, [BLOCKED, NEW_STORE], NOW),
          new Set(),
        );
      }
    } finally {
      await louezDb.db.execute(sql`RENAME TABLE billing_policies_hidden TO billing_policies`);
    }
  });
});
