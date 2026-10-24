import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canTransitionReservationStatus } from "./consumable-stock";
import {
  RESERVATION_ACTORS,
  invalidReservationTransitionMessage,
  planReservationStatusChange,
  type LockedReservation,
  type PlanReservationStatusChangeInput,
  type ReservationActivityType,
  type ReservationActor,
  type ReservationBillingEffect,
  type ReservationStatus,
  type ReservationStatusChangePlan,
} from "./reservation-status";
import { reservations } from "./schema";

const STATUSES = reservations.status.enumValues;
// The last second of a month, with milliseconds MySQL would round into the next one.
const NOW = new Date("2026-01-31T23:59:59.600Z");
const NOW_SECONDS = new Date("2026-01-31T23:59:59.000Z");
const IDS = { reservationId: "res_1", storeId: "store_1" };

type Expected = {
  stock: "consume" | "restore" | null;
  billable: "enters" | "stays" | "leaves" | "outside";
  activityType: ReservationActivityType;
  voids: boolean;
  date?: "pickedUpAt" | "returnedAt";
};

// Every change the graph allows, and what it must do. Every other pair is refused.
const ALLOWED: Record<string, Expected> = {
  "pending→confirmed": {
    stock: "consume",
    billable: "enters",
    activityType: "confirmed",
    voids: false,
  },
  "pending→rejected": { stock: null, billable: "outside", activityType: "rejected", voids: true },
  "pending→cancelled": { stock: null, billable: "outside", activityType: "cancelled", voids: true },
  "quote→confirmed": {
    stock: "consume",
    billable: "enters",
    activityType: "confirmed",
    voids: false,
  },
  "quote→declined": {
    stock: null,
    billable: "outside",
    activityType: "quote_declined",
    voids: true,
  },
  "quote→cancelled": { stock: null, billable: "outside", activityType: "cancelled", voids: true },
  "confirmed→ongoing": {
    stock: null,
    billable: "stays",
    activityType: "picked_up",
    voids: false,
    date: "pickedUpAt",
  },
  "confirmed→cancelled": {
    stock: "restore",
    billable: "leaves",
    activityType: "cancelled",
    voids: true,
  },
  // A completed rental keeps its consumables.
  "ongoing→completed": {
    stock: null,
    billable: "stays",
    activityType: "returned",
    voids: false,
    date: "returnedAt",
  },
  "ongoing→cancelled": {
    stock: "restore",
    billable: "leaves",
    activityType: "cancelled",
    voids: true,
  },
};

const locked = (status: ReservationStatus, extra: Partial<LockedReservation> = {}) => ({
  status,
  source: "online",
  billableAt: null,
  ...extra,
});

const input = (
  to: ReservationStatus,
  actor: ReservationActor,
  extra: Partial<PlanReservationStatusChangeInput> = {},
): PlanReservationStatusChangeInput => ({
  ...IDS,
  to,
  actor,
  actorUserId: null,
  now: NOW,
  ...extra,
});

function expectedPlan(
  from: ReservationStatus,
  to: ReservationStatus,
  actor: ReservationActor,
): ReservationStatusChangePlan {
  if (from === to) return { changed: false, reason: "already_in_target" };
  const expected = ALLOWED[`${from}→${to}`];
  if (!expected) return { changed: false, reason: "not_allowed" };

  const effects: ReservationBillingEffect[] = [];
  if (expected.billable === "enters" && actor !== "payment") {
    effects.push({ type: "legacy_fee.record", ...IDS, marketplace: false, at: NOW_SECONDS });
  }
  if (expected.voids) effects.push({ type: "legacy_fee.void", ...IDS });

  return {
    changed: true,
    stock: expected.stock,
    update: {
      status: to,
      updatedAt: NOW_SECONDS,
      ...(expected.billable === "enters" ? { billableAt: NOW_SECONDS } : {}),
      ...(expected.billable === "leaves" ? { withdrawnAt: NOW_SECONDS } : {}),
      ...(expected.date ? { [expected.date]: NOW_SECONDS } : {}),
    },
    activity: {
      activityType: expected.activityType,
      userId: null,
      metadata: { previousStatus: from, newStatus: to, actor },
      description: null,
      createdAt: NOW_SECONDS,
    },
    effects,
  };
}

describe("planReservationStatusChange", () => {
  test("the allowed changes are exactly the status graph", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        assert.equal(
          `${from}→${to}` in ALLOWED,
          canTransitionReservationStatus(from, to),
          `${from} → ${to}`,
        );
      }
    }
  });

  for (const actor of RESERVATION_ACTORS) {
    test(`every status pair, by ${actor}`, () => {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          assert.deepEqual(
            planReservationStatusChange(locked(from), input(to, actor)),
            expectedPlan(from, to, actor),
            `${from} → ${to} by ${actor}`,
          );
        }
      }
    });
  }

  test("no gate: every actor can make a reservation billable, and nothing else refuses", () => {
    const reasons = new Set<string>();
    for (const actor of RESERVATION_ACTORS) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          for (const expectedFrom of [undefined, from, "pending" as const]) {
            const plan = planReservationStatusChange(
              locked(from, { source: "marketplace" }),
              input(to, actor, { expectedFrom }),
            );
            if (!plan.changed) reasons.add(plan.reason);
          }
        }
        for (const from of ["pending", "quote"] as const) {
          const plan = planReservationStatusChange(locked(from), input("confirmed", actor));
          assert.equal(plan.changed, true, `${from} → confirmed by ${actor}`);
        }
      }
    }
    assert.deepEqual([...reasons].sort(), [
      "already_in_target",
      "not_allowed",
      "unexpected_status",
    ]);
  });

  test("expectedFrom refuses any other locked status, after already_in_target", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const other = STATUSES.find((status) => status !== from) ?? "pending";
        const asString = planReservationStatusChange(
          locked(from),
          input(to, "store_user", { expectedFrom: other }),
        );
        const asList = planReservationStatusChange(
          locked(from),
          input(to, "store_user", { expectedFrom: [other] }),
        );
        const expected = from === to ? "already_in_target" : "unexpected_status";
        assert.deepEqual(asString, { changed: false, reason: expected }, `${from} → ${to}`);
        assert.deepEqual(asList, { changed: false, reason: expected }, `${from} → ${to}`);

        const matching = planReservationStatusChange(
          locked(from),
          input(to, "store_user", { expectedFrom: [other, from] }),
        );
        assert.deepEqual(matching, expectedPlan(from, to, "store_user"), `${from} → ${to}`);
      }
    }
  });

  test("the record effect flags marketplace reservations only", () => {
    for (const [source, marketplace] of [
      ["marketplace", true],
      ["online", false],
      ["manual", false],
      [null, false],
    ] as const) {
      const plan = planReservationStatusChange(
        locked("pending", { source }),
        input("confirmed", "store_user"),
      );
      assert.ok(plan.changed);
      assert.deepEqual(
        plan.effects,
        [{ type: "legacy_fee.record", ...IDS, marketplace, at: NOW_SECONDS }],
        String(source),
      );
    }
  });

  test("a billable_at already set is kept, and the fee is still recorded", () => {
    const billableAt = new Date("2026-01-10T08:00:00.000Z");
    const plan = planReservationStatusChange(
      locked("quote", { billableAt }),
      input("confirmed", "customer"),
    );
    assert.ok(plan.changed);
    assert.equal("billableAt" in plan.update, false);
    assert.equal(plan.effects[0]?.type, "legacy_fee.record");
  });

  test("now is cut to whole seconds, so the fee and the dates stay in January", () => {
    const plan = planReservationStatusChange(locked("pending"), input("confirmed", "mcp"));
    assert.ok(plan.changed);
    const january = "2026-01-31T23:59:59.000Z";
    assert.deepEqual(
      plan.effects.map((effect) => effect.type === "legacy_fee.record" && effect.at.toISOString()),
      [january],
    );
    assert.equal(plan.update.billableAt?.toISOString(), january);
    assert.equal(plan.update.updatedAt.toISOString(), january);
    assert.equal(plan.activity.createdAt.toISOString(), january);
  });

  test("the activity takes the caller's type, metadata, description and user", () => {
    const plan = planReservationStatusChange(
      locked("quote"),
      input("confirmed", "customer", {
        actorUserId: "user_1",
        activity: {
          type: "quote_accepted",
          metadata: { source: "quote_acceptance", actor: "customer" },
          description: "Accepted by the customer",
        },
      }),
    );
    assert.ok(plan.changed);
    assert.deepEqual(plan.activity, {
      activityType: "quote_accepted",
      userId: "user_1",
      metadata: {
        previousStatus: "quote",
        newStatus: "confirmed",
        actor: "customer",
        source: "quote_acceptance",
      },
      description: "Accepted by the customer",
      createdAt: NOW_SECONDS,
    });
  });
});

test("the refusal message lists the allowed statuses, or none", () => {
  assert.equal(
    invalidReservationTransitionMessage("pending", "ongoing"),
    "Invalid transition: pending → ongoing. Allowed: confirmed, rejected, cancelled",
  );
  assert.equal(
    invalidReservationTransitionMessage("completed", "confirmed"),
    "Invalid transition: completed → confirmed. Allowed: none",
  );
});
