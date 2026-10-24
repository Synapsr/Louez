import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";

import type { LegacyFeeEffectDeps } from "./reservation-effects";

// Fakes only. DATABASE_URL points at a closed port, so a real query would fail.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";

const AT = new Date("2026-01-31T23:59:59Z");

const record = (reservationId: string, marketplace = false): ReservationBillingEffect => ({
  type: "legacy_fee.record",
  storeId: "store",
  reservationId,
  marketplace,
  at: AT,
});

const voidFee = (reservationId: string): ReservationBillingEffect => ({
  type: "legacy_fee.void",
  storeId: "store",
  reservationId,
});

type FakeCall = "read" | "reservation" | "marketplace" | "void";

/**
 * Deps that record each call. A call named in `failing` throws. Each status read
 * returns the next entry of `reads`, or throws it when it is an error, then
 * "confirmed".
 */
function fakes(
  options: {
    billing?: boolean;
    reads?: ReadonlyArray<ReservationStatus | null | Error>;
    failing?: FakeCall[];
  } = {},
) {
  const calls: Array<{ call: FakeCall; input: unknown }> = [];
  const errors: string[] = [];
  const reads = [...(options.reads ?? [])];
  const called = (call: FakeCall, input: unknown) => {
    calls.push({ call, input });
    if (options.failing?.includes(call)) throw new Error(`${call} failed`);
  };
  const deps: LegacyFeeEffectDeps = {
    isBillingEnabled: () => options.billing ?? true,
    readReservationStatus: async (reservationId, storeId) => {
      called("read", { reservationId, storeId });
      const next = reads.length > 0 ? reads.shift() : "confirmed";
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    recordReservationFee: async (input) => {
      called("reservation", input);
      return { recorded: true };
    },
    recordMarketplaceFee: async (input) => {
      called("marketplace", input);
      return { recorded: true };
    },
    voidReservationFee: async (reservationId) => {
      called("void", reservationId);
      return { voided: true };
    },
    log: {
      error: (tag, message) => errors.push(`${tag}: ${message}`),
      info: () => undefined,
    },
  };
  return { deps, calls, errors, names: () => calls.map(({ call }) => call) };
}

describe("reservation fee effects", () => {
  let effects: typeof import("./reservation-effects");

  before(async () => {
    effects = await import("./reservation-effects");
  });

  test("with billing off, or nothing to run, nothing is called", async () => {
    const off = fakes({ billing: false });
    await effects.createLegacyFeeEffectRunner(off.deps)([record("r1", true), voidFee("r2")]);
    assert.deepEqual(off.calls, []);

    const empty = fakes();
    await effects.createLegacyFeeEffectRunner(empty.deps)([]);
    assert.deepEqual(empty.calls, []);
  });

  test("a record reads the status, records the reservation fee at the change's date, then reads it again", async () => {
    const fake = fakes();
    await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1")]);

    const read = { call: "read", input: { reservationId: "r1", storeId: "store" } };
    assert.deepEqual(fake.calls, [
      read,
      {
        call: "reservation",
        input: { storeId: "store", reservationId: "r1", source: "manual", at: AT },
      },
      read,
    ]);
    assert.deepEqual(fake.errors, []);
  });

  test("a marketplace reservation also gets the marketplace fee", async () => {
    const fake = fakes();
    await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1", true)]);

    assert.deepEqual(fake.names(), ["read", "reservation", "marketplace", "read"]);
    assert.deepEqual(fake.calls[2]?.input, {
      storeId: "store",
      reservationId: "r1",
      source: "manual",
      at: AT,
    });
  });

  test("a record on a reservation withdrawn since, or gone, voids instead", async () => {
    for (const status of ["cancelled", "rejected", "declined", null] as const) {
      const fake = fakes({ reads: [status] });
      await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1", true)]);

      assert.deepEqual(fake.names(), ["read", "void"], `status ${status}`);
      assert.equal(fake.calls[1]?.input, "r1");
      assert.deepEqual(fake.errors, []);
    }
  });

  test("a record on a reservation still pending or a quote writes and voids nothing, and logs it", async () => {
    for (const status of ["pending", "quote"] as const) {
      const fake = fakes({ reads: [status] });
      await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1", true)]);

      assert.deepEqual(fake.names(), ["read"], `status ${status}`);
      assert.equal(fake.errors.length, 1);
      assert.match(fake.errors[0] ?? "", new RegExp(`not recorded.*r1.*${status}.*before`));
    }
  });

  test("a record on a reservation cancelled while its fees were written voids them", async () => {
    const fake = fakes({ reads: ["confirmed", "cancelled"] });
    await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1", true)]);

    assert.deepEqual(fake.names(), ["read", "reservation", "marketplace", "read", "void"]);
    assert.equal(fake.calls[4]?.input, "r1");
    assert.deepEqual(fake.errors, []);
  });

  test("a failed reservation fee still records the marketplace fee", async () => {
    const fake = fakes({ failing: ["reservation"] });
    await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1", true)]);

    assert.deepEqual(fake.names(), ["read", "reservation", "marketplace", "read"]);
    assert.equal(fake.errors.length, 1);
    assert.match(fake.errors[0] ?? "", /^payg: .*reservation fee.*r1.*reservation failed/);
  });

  test("a failed status read records nothing, and a failed second read is logged", async () => {
    const unread = fakes({ failing: ["read"] });
    await effects.createLegacyFeeEffectRunner(unread.deps)([record("r1", true)]);

    assert.deepEqual(unread.names(), ["read"]);
    assert.equal(unread.errors.length, 1);
    assert.match(unread.errors[0] ?? "", /not recorded.*r1.*read failed/);

    const unchecked = fakes({ reads: ["confirmed", new Error("second read failed")] });
    await effects.createLegacyFeeEffectRunner(unchecked.deps)([record("r1")]);

    assert.deepEqual(unchecked.names(), ["read", "reservation", "read"]);
    assert.equal(unchecked.errors.length, 1);
    assert.match(
      unchecked.errors[0] ?? "",
      /not checked for a cancellation.*r1.*second read failed/,
    );
  });

  test("a logged failure names the database's reason, not only drizzle's failed query", async () => {
    // Drizzle's DrizzleQueryError: the SQL as the message, the driver's error as the cause.
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), {
      code: "ER_LOCK_DEADLOCK",
    });
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    const fake = fakes({
      reads: [
        new Error("Failed query: select `reservation_status`", { cause: deadlock }),
        new Error("Failed query: select `reservation_status`", { cause: refused }),
      ],
    });
    await effects.createLegacyFeeEffectRunner(fake.deps)([record("r1"), record("r2")]);

    assert.deepEqual(fake.errors, [
      "payg: fee not recorded: could not read the status of reservation r1 (store store): Failed query: select `reservation_status`, caused by ER_LOCK_DEADLOCK: Deadlock found when trying to get lock",
      "payg: fee not recorded: could not read the status of reservation r2 (store store): Failed query: select `reservation_status`, caused by connect ECONNREFUSED 127.0.0.1:1",
    ]);
  });

  test("a void voids the reservation's fees", async () => {
    const fake = fakes();
    await effects.createLegacyFeeEffectRunner(fake.deps)([voidFee("r1")]);

    assert.deepEqual(fake.calls, [{ call: "void", input: "r1" }]);
  });

  test("nothing throws: each failure is logged and the next effects still run, in order", async () => {
    const fake = fakes({ failing: ["reservation", "marketplace", "void"] });
    const run = effects.createLegacyFeeEffectRunner(fake.deps);

    await assert.doesNotReject(run([voidFee("r1"), record("r2", true), voidFee("r3")]));

    assert.deepEqual(fake.names(), ["void", "read", "reservation", "marketplace", "read", "void"]);
    assert.deepEqual(
      fake.calls.filter(({ call }) => call === "void").map(({ input }) => input),
      ["r1", "r3"],
    );
    assert.equal(fake.errors.length, 4);

    const unreadable = fakes({ failing: ["read", "void"] });
    await assert.doesNotReject(
      effects.createLegacyFeeEffectRunner(unreadable.deps)([record("r1"), voidFee("r1")]),
    );
    assert.equal(unreadable.errors.length, 2);
  });
});
