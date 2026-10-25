import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { canonicalHash } from "./canonical-json";
import {
  type FakeBillingService,
  type FakeHandler,
  type FakeRequest,
  captureAlerts,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";
import type { RelayOptions } from "./relay";
import type { BuiltSnapshot } from "./snapshots/build-snapshot";
import type { ReservationSnapshotData, StoreSnapshotData } from "./snapshots/snapshot-data";

// A full relay run against a fake billing service that checks Louez's signatures and
// signs its answers (louez-billing docs/api, README §4, §5 and §6). The snapshots
// come from a stub builder, so the test is about the queue, not the builders.

const storeData = (slug: string): StoreSnapshotData => ({
  deleted: false,
  slug,
  createdAt: "2026-01-02T03:04:05Z",
  onboardingCompleted: true,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
  ownerUserIds: ["user_owner"],
  legalCountry: null,
  stripeConnect: { accountId: null, chargesEnabled: false, onboardingComplete: false },
  marketplace: {
    status: null,
    firstPublishedAt: null,
    cohortRank: null,
    lifetimeFeeWaiverAt: null,
  },
  referral: { referredByStoreId: null, referredByUserId: null, signupOrigin: null },
  finalReservations: null,
});

const reservationData = (number: string): ReservationSnapshotData => ({
  deleted: false,
  number,
  status: "confirmed",
  source: "online",
  createdAt: "2026-10-01T08:00:00Z",
  startAt: "2026-10-10T08:00:00Z",
  endAt: "2026-10-12T08:00:00Z",
  billableAt: "2026-10-01T08:05:00Z",
  withdrawnAt: null,
  currency: "EUR",
  totalInclTaxMinor: 12_000,
  insuranceMinor: 0,
  payments: [],
});

type EventResult = {
  id: string;
  status: "accepted" | "duplicate" | "stale" | "rejected";
  heldVersion: number | null;
  error: { code: string; message: string; path: string | null } | null;
};

const envelopeSchema = z.object({
  schema: z.literal("louez.billing.event/1"),
  id: z.string(),
  type: z.string(),
  schemaVersion: z.literal(1),
  aggregateId: z.string(),
  storeId: z.string(),
  version: z.number(),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
  final: z.literal(false),
  data: z.record(z.string(), z.unknown()),
});
const eventsBody = z.object({ events: z.array(envelopeSchema) });

describe("billing relay (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let relay: typeof import("./relay");
  let locks: typeof import("./locks");
  const snapshots = new Map<string, BuiltSnapshot>();
  let answer: (event: z.infer<typeof envelopeSchema>) => EventResult = (event) => ({
    id: event.id,
    status: "accepted",
    heldVersion: event.version,
    error: null,
  });
  const answerEvents: FakeHandler = (request) => {
    const { events } = eventsBody.parse(request.json());
    return { status: 200, body: { results: events.map((event) => answer(event)) } };
  };

  before(async () => {
    database = await createTestDatabase("billing_relay");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    relay = await import("./relay");
    locks = await import("./locks");
    service.handle("/events", answerEvents);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.execute(sql`DELETE FROM billing_sync_queue`);
    await louezDb.db.execute(sql`DELETE FROM billing_sync_state`);
    service.requests.length = 0;
    snapshots.clear();
    answer = (event) => ({
      id: event.id,
      status: "accepted",
      heldVersion: event.version,
      error: null,
    });
  });

  const build = async (_db: unknown, key: { type: string; aggregateId: string }) =>
    snapshots.get(`${key.type}:${key.aggregateId}`) ?? { kind: "missing" as const };

  async function run(alerts = captureAlerts(), options: Omit<RelayOptions, "alerts"> = {}) {
    const result = await relay.runRelay({
      build,
      ...options,
      alerts: {
        log: alerts.log,
        alert: async (kind, message) => void alerts.errors.push(`${kind}: ${message}`),
      },
    });
    return { result, alerts };
  }

  const singleEventMode = () =>
    louezDb.db.insert(louezDb.billingSyncState).values({ id: 1, singleEventMode: true });

  const rowSchema = z.object({
    version: z.coerce.number(),
    delivered: z.coerce.number(),
    sentHash: z.string().nullable(),
    status: z.string(),
    attempts: z.coerce.number(),
    lastError: z.string().nullable(),
    waiting: z.coerce.number(),
  });

  async function row(type: string, id: string) {
    const [result] = await louezDb.db.execute(
      sql`SELECT version, delivered_version AS delivered, sent_hash AS sentHash, status,
                 attempt_count AS attempts, last_error AS lastError,
                 next_attempt_at > NOW(3) AS waiting
          FROM billing_sync_queue WHERE aggregate_type = ${type} AND aggregate_id = ${id}`,
    );
    return z.array(rowSchema).parse(result)[0];
  }

  const sentEvents = (requests: readonly FakeRequest[]) =>
    requests
      .filter((request) => request.target === "/api/v1/louez/events")
      .map((request) => eventsBody.parse(request.json()).events.map((event) => event.id));

  test("a run sends due rows, stores first, and applies each result to its row", async () => {
    await louezDb.markReservation(louezDb.db, { id: "r1", storeId: "s1" });
    await louezDb.markReservation(louezDb.db, { id: "r2", storeId: "s1" });
    await louezDb.markReservation(louezDb.db, { id: "r3", storeId: "s1" });
    await louezDb.markReservation(louezDb.db, { id: "r4", storeId: "s1" });
    await louezDb.markReservation(louezDb.db, { id: "gone", storeId: "s1" });
    await louezDb.markLegacyStore(louezDb.db, "s1");
    await louezDb.markStore(louezDb.db, "s1");
    snapshots.set("store:s1", { kind: "snapshot", data: storeData("s-one") });
    for (const id of ["r1", "r2", "r3", "r4"]) {
      snapshots.set(`reservation:${id}`, { kind: "snapshot", data: reservationData(id) });
    }
    snapshots.set("legacy_store:s1", { kind: "skip", reason: "new_store" });
    answer = (event) => {
      const byId: Record<string, EventResult> = {
        "reservation.snapshot:r1:1": {
          id: event.id,
          status: "duplicate",
          heldVersion: 1,
          error: null,
        },
        "reservation.snapshot:r2:1": {
          id: event.id,
          status: "rejected",
          heldVersion: null,
          error: {
            code: "invalid_data",
            message: "must be 0 or more",
            path: "/data/totalInclTaxMinor",
          },
        },
        "reservation.snapshot:r3:1": {
          id: event.id,
          status: "rejected",
          heldVersion: 5,
          error: { code: "id_reused", message: "id applied with other data", path: null },
        },
        "reservation.snapshot:r4:1": {
          id: event.id,
          status: "rejected",
          heldVersion: null,
          error: { code: "processing_failed", message: "the service failed", path: null },
        },
      };
      return (
        byId[event.id] ?? {
          id: event.id,
          status: "accepted",
          heldVersion: event.version,
          error: null,
        }
      );
    };

    const { result, alerts } = await run();

    assert.equal(result.outcome, "ok");
    assert.ok(
      service.requests.every((request) => request.verified),
      "every request was signed",
    );
    // r3 was force-marked past heldVersion during the run and went out again in it.
    assert.deepEqual(sentEvents(service.requests), [
      [
        "store.snapshot:s1:1",
        "reservation.snapshot:r1:1",
        "reservation.snapshot:r2:1",
        "reservation.snapshot:r3:1",
        "reservation.snapshot:r4:1",
      ],
      ["reservation.snapshot:r3:6"],
    ]);
    const [request] = service.requests;
    const store = request ? eventsBody.parse(request.json()).events[0] : undefined;
    assert.equal(store?.type, "store.snapshot");
    assert.equal(store?.storeId, "s1");
    assert.deepEqual(store?.data, storeData("s-one"));

    assert.deepEqual(await row("store", "s1"), {
      version: 1,
      delivered: 1,
      sentHash: canonicalHash(storeData("s-one")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });
    assert.equal((await row("reservation", "r1"))?.status, "synced");
    // invalid_data: one attempt, then 2 minutes before the next.
    assert.deepEqual(await row("reservation", "r2"), {
      version: 1,
      delivered: 0,
      sentHash: null,
      status: "pending",
      attempts: 1,
      lastError: "invalid_data at /data/totalInclTaxMinor: must be 0 or more",
      waiting: 1,
    });
    // id_reused: not an attempt; the version went past heldVersion 5.
    assert.deepEqual(await row("reservation", "r3"), {
      version: 6,
      delivered: 6,
      sentHash: canonicalHash(reservationData("r3")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });
    assert.equal((await row("reservation", "r4"))?.attempts, 1);
    assert.equal((await row("reservation", "r4"))?.waiting, 1);
    // The stub skips the new store's legacy aggregate, and "gone" is missing.
    assert.equal((await row("legacy_store", "s1"))?.status, "synced");
    assert.equal((await row("legacy_store", "s1"))?.delivered, 0);
    assert.equal((await row("reservation", "gone"))?.status, "synced");
    assert.deepEqual(result.counts, {
      sent: 6,
      delivered: 3,
      unchanged: 0,
      skipped: 1,
      missing: 1,
      retried: 3,
      dead: 0,
      buildFailed: 0,
    });
    assert.ok(alerts.errors.some((line) => line.includes("gone of store s1 no longer exists")));

    // A plain mark with unchanged content is synced without a call.
    await louezDb.markStore(louezDb.db, "s1");
    const requestsBefore = service.requests.length;
    const second = await run();
    assert.equal(second.result.outcome, "ok");
    assert.equal(service.requests.length, requestsBefore);
    assert.equal(second.result.counts.unchanged, 1);
    assert.deepEqual(await row("store", "s1"), {
      version: 2,
      delivered: 1,
      sentHash: canonicalHash(storeData("s-one")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });

    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.ok(state?.lastRelayOkAt, "a successful run records its time");
    assert.equal(state?.consecutiveFailures, 0);
  });

  test("a forced mark sends unchanged content; a newer mark during the send keeps the row pending", async () => {
    snapshots.set("store:s2", { kind: "snapshot", data: storeData("s-two") });
    await louezDb.markStore(louezDb.db, "s2");
    await run();
    await louezDb.markStore(louezDb.db, "s2", { force: true });
    let marked = false;
    service.handle("/events", async (request) => {
      const { events } = eventsBody.parse(request.json());
      if (!marked) {
        // A business write lands while the batch is in flight.
        marked = true;
        await louezDb.markStore(louezDb.db, "s2");
      }
      return { status: 200, body: { results: events.map((event) => answer(event)) } };
    });
    try {
      await run();
    } finally {
      service.handle("/events", answerEvents);
    }
    // Version 2 was delivered but the row stayed pending, so version 3 went out too.
    assert.deepEqual(sentEvents(service.requests), [
      ["store.snapshot:s2:1"],
      ["store.snapshot:s2:2"],
      ["store.snapshot:s2:3"],
    ]);
    assert.deepEqual(await row("store", "s2"), {
      version: 3,
      delivered: 3,
      sentHash: canonicalHash(storeData("s-two")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });
  });

  test("the fifth rejection makes a row dead and alerts", async () => {
    snapshots.set("reservation:r9", { kind: "snapshot", data: reservationData("r9") });
    await louezDb.markReservation(louezDb.db, { id: "r9", storeId: "s9" });
    await louezDb.db.execute(sql`UPDATE billing_sync_queue SET attempt_count = 4`);
    answer = (event) => ({
      id: event.id,
      status: "rejected",
      heldVersion: null,
      error: { code: "aggregate_mismatch", message: "another store", path: "/storeId" },
    });
    const { result, alerts } = await run();
    assert.equal(result.counts.dead, 1);
    assert.equal((await row("reservation", "r9"))?.status, "dead");
    assert.ok(alerts.errors.some((line) => line.startsWith("event_dead:")));
  });

  test("a 400 on a batch sends one event per request; alone, a 400 is dead", async () => {
    for (const id of ["a1", "a2", "a3"]) {
      snapshots.set(`reservation:${id}`, { kind: "snapshot", data: reservationData(id) });
      await louezDb.markReservation(louezDb.db, { id, storeId: "s3" });
    }
    service.handle("/events", (request) => {
      const { events } = eventsBody.parse(request.json());
      if (events.length > 1 || events[0]?.aggregateId === "a2") {
        return { status: 400, body: { code: "invalid_request" } };
      }
      return { status: 200, body: { results: events.map((event) => answer(event)) } };
    });
    try {
      const { result, alerts } = await run();
      assert.equal(result.outcome, "ok");
      assert.deepEqual(sentEvents(service.requests), [
        ["reservation.snapshot:a1:1", "reservation.snapshot:a2:1", "reservation.snapshot:a3:1"],
        ["reservation.snapshot:a1:1"],
        ["reservation.snapshot:a2:1"],
        ["reservation.snapshot:a3:1"],
      ]);
      assert.equal((await row("reservation", "a1"))?.status, "synced");
      assert.equal((await row("reservation", "a2"))?.status, "dead");
      assert.equal((await row("reservation", "a3"))?.status, "synced");
      assert.ok(alerts.errors.some((line) => line.startsWith("event_dead:")));
    } finally {
      service.handle("/events", answerEvents);
    }
  });

  test("503 with Retry-After stops the run and holds every call until it passes", async () => {
    snapshots.set("store:s4", { kind: "snapshot", data: storeData("s-four") });
    await louezDb.markStore(louezDb.db, "s4");
    service.handle("/events", () => ({
      status: 503,
      body: { code: "unavailable" },
      headers: { "Retry-After": "120" },
      signed: false,
    }));
    try {
      const first = await run();
      assert.equal(first.result.outcome, "waiting");
      const before = service.requests.length;
      const second = await run();
      assert.equal(second.result.outcome, "waiting");
      assert.equal(service.requests.length, before, "no call before Retry-After");
      assert.deepEqual(await row("store", "s4"), {
        version: 1,
        delivered: 0,
        sentHash: null,
        status: "pending",
        attempts: 0,
        lastError: null,
        waiting: 0,
      });
    } finally {
      service.handle("/events", answerEvents);
    }
  });

  test("a 5xx is a transport failure: rows untouched, failures counted, single-event mode after three", async () => {
    snapshots.set("store:s5", { kind: "snapshot", data: storeData("s-five") });
    await louezDb.markStore(louezDb.db, "s5");
    service.handle("/events", () => ({ status: 500, body: { code: "internal_error" } }));
    try {
      for (let index = 0; index < 3; index += 1) {
        const { result } = await run();
        assert.equal(result.outcome, "transport_failure");
      }
      const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
      assert.equal(state?.consecutiveFailures, 3);
      assert.equal(state?.serverErrorRuns, 3);
      assert.equal(state?.singleEventMode, true);
      assert.equal((await row("store", "s5"))?.attempts, 0);

      // Alone, in single-event mode, the third 5xx in a row makes it dead.
      for (let index = 0; index < 3; index += 1) await run();
      assert.equal((await row("store", "s5"))?.status, "dead");
    } finally {
      service.handle("/events", answerEvents);
    }
    // One clean run brings back batches.
    await run();
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.singleEventMode, false);
    assert.equal(state?.serverErrorRuns, 0);
  });

  test("a change undone while its send is in flight is sent again", async () => {
    snapshots.set("store:s6", { kind: "snapshot", data: storeData("s-six") });
    await louezDb.markStore(louezDb.db, "s6");
    await run();
    snapshots.set("store:s6", { kind: "snapshot", data: storeData("s-six-renamed") });
    await louezDb.markStore(louezDb.db, "s6");
    let undone = false;
    service.handle("/events", async (request) => {
      if (!undone) {
        // The owner undoes the change while version 2 is in flight.
        undone = true;
        snapshots.set("store:s6", { kind: "snapshot", data: storeData("s-six") });
        await louezDb.markStore(louezDb.db, "s6");
      }
      return answerEvents(request);
    });
    try {
      await run();
    } finally {
      service.handle("/events", answerEvents);
    }
    // The service now holds version 2, so version 3 differs from it, though it
    // equals version 1.
    assert.deepEqual(sentEvents(service.requests), [
      ["store.snapshot:s6:1"],
      ["store.snapshot:s6:2"],
      ["store.snapshot:s6:3"],
    ]);
    assert.deepEqual(await row("store", "s6"), {
      version: 3,
      delivered: 3,
      sentHash: canonicalHash(storeData("s-six")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });
  });

  test("a send that timed out forgets the sent hash, so a change undone after it is sent", async () => {
    snapshots.set("store:s7", { kind: "snapshot", data: storeData("s-seven") });
    await louezDb.markStore(louezDb.db, "s7");
    await run();
    snapshots.set("store:s7", { kind: "snapshot", data: storeData("s-seven-renamed") });
    await louezDb.markStore(louezDb.db, "s7");
    // The service applies version 2, but its answer comes after Louez's timeout.
    const timingOut: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith("/events")) return response;
      await response.arrayBuffer();
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    };
    const failed = await run(captureAlerts(), { client: { fetch: timingOut } });
    assert.equal(failed.result.outcome, "transport_failure");
    // The row is as it was, but for the hash: Louez no longer knows which content
    // the service holds.
    assert.deepEqual(await row("store", "s7"), {
      version: 2,
      delivered: 1,
      sentHash: null,
      status: "pending",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });

    snapshots.set("store:s7", { kind: "snapshot", data: storeData("s-seven") });
    await louezDb.markStore(louezDb.db, "s7");
    const { result } = await run();
    assert.equal(result.counts.unchanged, 0);
    assert.deepEqual(sentEvents(service.requests).at(-1), ["store.snapshot:s7:3"]);
    assert.deepEqual(await row("store", "s7"), {
      version: 3,
      delivered: 3,
      sentHash: canonicalHash(storeData("s-seven")),
      status: "synced",
      attempts: 0,
      lastError: null,
      waiting: 0,
    });
  });

  test("alone in single-event mode, a 5xx forgets the sent hash too", async () => {
    snapshots.set("store:s8", { kind: "snapshot", data: storeData("s-eight") });
    await louezDb.markStore(louezDb.db, "s8");
    await run();
    await louezDb.db.update(louezDb.billingSyncState).set({ singleEventMode: true });
    snapshots.set("store:s8", { kind: "snapshot", data: storeData("s-eight-renamed") });
    await louezDb.markStore(louezDb.db, "s8");
    service.handle("/events", () => ({ status: 500, body: { code: "internal_error" } }));
    try {
      await run();
    } finally {
      service.handle("/events", answerEvents);
    }
    const failed = await row("store", "s8");
    assert.equal(failed?.sentHash, null);
    assert.equal(failed?.status, "pending");
    assert.equal(failed?.attempts, 0);
    assert.match(failed?.lastError ?? "", /^server_error 1\/3/);

    snapshots.set("store:s8", { kind: "snapshot", data: storeData("s-eight") });
    await louezDb.markStore(louezDb.db, "s8");
    await run();
    assert.deepEqual(sentEvents(service.requests).at(-1), ["store.snapshot:s8:3"]);
    assert.equal((await row("store", "s8"))?.status, "synced");
  });

  test("a run starts no request after its time limit, even one event per request", async () => {
    await singleEventMode();
    for (let index = 0; index < 20; index += 1) {
      snapshots.set(`store:t${index}`, { kind: "snapshot", data: storeData(`t-${index}`) });
      await louezDb.markStore(louezDb.db, `t${index}`);
    }
    service.handle("/events", async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return answerEvents(request);
    });
    const startedAt = Date.now();
    let outcome: string;
    try {
      outcome = (await run(captureAlerts(), { timeLimitMs: 1000 })).result.outcome;
    } finally {
      service.handle("/events", answerEvents);
    }
    const elapsed = Date.now() - startedAt;
    const sent = sentEvents(service.requests);
    assert.equal(outcome, "ok");
    assert.ok(sent.length >= 1 && sent.length <= 4, `${sent.length} requests`);
    assert.ok(
      sent.every((events) => events.length === 1),
      "one event per request",
    );
    assert.ok(elapsed < 3000, `the run took ${elapsed} ms`);
    // The rest waits at its version for the next run, with no attempt counted.
    const [rows] = await louezDb.db.execute(
      sql`SELECT COUNT(*) AS waiting FROM billing_sync_queue
          WHERE status = 'pending' AND version = 1 AND delivered_version = 0
            AND attempt_count = 0 AND next_attempt_at <= NOW(3)`,
    );
    const [left] = z.array(z.object({ waiting: z.coerce.number() })).parse(rows);
    assert.equal(left?.waiting, 20 - sent.length);
  });

  test("one event per request, the run keeps to its share of the request budget", async () => {
    await singleEventMode();
    for (const id of ["p1", "p2", "p3"]) {
      snapshots.set(`store:${id}`, { kind: "snapshot", data: storeData(id) });
      await louezDb.markStore(louezDb.db, id);
    }
    const arrivals: number[] = [];
    service.handle("/events", (request) => {
      arrivals.push(Date.now());
      return answerEvents(request);
    });
    try {
      await run();
    } finally {
      service.handle("/events", answerEvents);
    }
    assert.equal(arrivals.length, 3);
    const spacing = 60_000 / relay.RELAY_REQUESTS_PER_MINUTE;
    for (const [index, at] of arrivals.slice(1).entries()) {
      const gap = at - (arrivals[index] ?? 0);
      assert.ok(gap >= spacing - 30, `requests ${gap} ms apart, under ${spacing} ms`);
    }
  });

  test("the real builders run inside the relay's consistent snapshot", async () => {
    await louezDb.db.insert(louezDb.stores).values({
      id: "relay_real_store",
      userId: "user_real",
      name: "Real store",
      slug: "relay-real-store",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await louezDb.markStore(louezDb.db, "relay_real_store");
    const captured = captureAlerts();
    const result = await relay.runRelay({
      alerts: {
        log: captured.log,
        alert: async (kind, message) => void captured.errors.push(`${kind}: ${message}`),
      },
    });
    assert.equal(result.outcome, "ok", captured.errors.join("\n"));
    const [request] = service.requests;
    const [event] = request ? eventsBody.parse(request.json()).events : [];
    assert.equal(event?.id, "store.snapshot:relay_real_store:1");
    assert.equal(event?.data.slug, "relay-real-store");
    assert.equal(event?.data.deleted, false);
    assert.equal((await row("store", "relay_real_store"))?.status, "synced");
  });

  test("an alert of a kind reaches Discord at most once an hour", async () => {
    const alertsModule = await import("./alerts");
    const captured = captureAlerts();
    const alerts = alertsModule.createBillingAlerts({ log: captured.log, notify: captured.notify });
    await alerts.alert("relay_stale", "first");
    await alerts.alert("relay_stale", "second");
    await alerts.alert("clock_skew", "other kind");
    assert.deepEqual(captured.notified, ["relay_stale", "clock_skew"]);
    assert.equal(captured.errors.length, 3, "every alert is logged");
  });

  test("a task runs under its MySQL lock and is skipped while another run holds it", async () => {
    const holder = await database.connect();
    try {
      await holder.query("SELECT GET_LOCK(?, 0)", [locks.billingLockName("relay")]);
      assert.deepEqual(await locks.withBillingLock("relay", async () => "ran"), { ran: false });
      await holder.query("SELECT RELEASE_LOCK(?)", [locks.billingLockName("relay")]);
      assert.deepEqual(await locks.withBillingLock("relay", async () => "ran"), {
        ran: true,
        value: "ran",
      });
    } finally {
      await holder.end();
    }
  });
});
