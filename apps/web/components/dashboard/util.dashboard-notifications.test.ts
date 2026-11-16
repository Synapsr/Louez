import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { reservationPollSchema } from "@louez/api/contracts/reservations";

import type { NeedsALook, NeedsALookItem } from "@/lib/inbox/needs-a-look";
import type { DisplayFormat } from "@/lib/inbox/needs-a-look-display";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";

import {
  NEEDS_A_LOOK_IN_BELL,
  NEEDS_A_LOOK_PAGE,
  needsALookInBell,
  notificationsBadge,
} from "./util.dashboard-notifications";

// What the notification bell shows of what needs a look: its section and its
// part of the badge come only from a successful read of the current store,
// never from the 30-second poll.

const format: DisplayFormat = {
  money: (amount, currency) => `${amount} ${currency}`,
  day: () => "1 Nov",
};

const refund = (index: number): NeedsALookItem =>
  ({
    id: `refund_undone:${index}`,
    type: "refund_undone",
    severity: "warning",
    occurredAt: new Date(Date.UTC(2026, 10, 1, index)),
    summary: "",
    reservation: {
      id: `res_${index}`,
      number: `R-${index}`,
      startDate: new Date(),
      endDate: new Date(),
      customerName: "Camille Martin",
    },
    details: {
      reservationId: `res_${index}`,
      reservationNumber: `R-${index}`,
      amount: "60.00",
      currency: "EUR",
    },
    tools: [],
    links: { dashboard: "" },
  }) as NeedsALookItem;

const summary = (count: number): NeedsALook => ({
  items: Array.from({ length: count }, (_, index) => refund(index)),
  more: false,
  incomplete: false,
});

describe("the bell's section of what needs a look", () => {
  test("items read: the most recent five, each opening its booking's payment, and the count of all", () => {
    const shown = needsALookInBell({ status: "success", data: summary(7) }, format);
    assert.equal(shown?.count, 7);
    assert.equal(shown?.rows.length, NEEDS_A_LOOK_IN_BELL);
    assert.deepEqual(
      shown?.rows.map((row) => row.id),
      [
        "refund_undone:6",
        "refund_undone:5",
        "refund_undone:4",
        "refund_undone:3",
        "refund_undone:2",
      ],
    );
    assert.deepEqual(shown?.rows[0], {
      id: "refund_undone:6",
      title: { key: "refundUndone.title" },
      line: ["#R-6", "Camille Martin", "60.00 EUR"],
      href: "/dashboard/reservations/res_6#payment",
    });
    // "See all" leads to the page, for the rest, the details and "Mark as handled".
    assert.equal(NEEDS_A_LOOK_PAGE, "/dashboard/inbox");
  });

  test("an item with nowhere to open leads to the page", () => {
    const operation = {
      ...refund(0),
      id: "operation_unknown:op",
      type: "operation_unknown",
      reservation: null,
      details: { procedure: "dashboard.settings.update", targetId: null, clientName: null },
    } as unknown as NeedsALookItem;
    const shown = needsALookInBell(
      { status: "success", data: { items: [operation], more: false, incomplete: false } },
      format,
    );
    assert.equal(shown?.rows[0]?.href, NEEDS_A_LOOK_PAGE);
  });

  test("nothing when none, while loading, after a failure, or after a refusal that follows a success", () => {
    // A session that may not read them gets none from the API: the same empty read.
    assert.equal(needsALookInBell({ status: "success", data: summary(0) }, format), null);
    assert.equal(needsALookInBell({ status: "pending" }, format), null);
    assert.equal(needsALookInBell({ status: "error" }, format), null);
    // A refetch refused (rights removed meanwhile) keeps the earlier answer in `data`.
    assert.equal(needsALookInBell({ status: "error", data: summary(3) }, format), null);
  });
});

describe("the bell's badge", () => {
  test("the polled counts plus the items to check, once read", () => {
    assert.equal(notificationsBadge({ polled: 2, read: "success", toCheck: 3 }), "5");
    assert.equal(notificationsBadge({ polled: 0, read: "success", toCheck: 3 }), "3");
    assert.equal(notificationsBadge({ polled: 8, read: "success", toCheck: 3 }), "9+");
  });

  test("no badge while the items are read, so no total that is about to change", () => {
    assert.equal(notificationsBadge({ polled: 2, read: "pending", toCheck: 0 }), null);
  });

  test("a failed or refused read adds nothing, whatever it held before", () => {
    assert.equal(notificationsBadge({ polled: 2, read: "error", toCheck: 3 }), "2");
    assert.equal(notificationsBadge({ polled: 0, read: "error", toCheck: 3 }), null);
    assert.equal(notificationsBadge({ polled: 0, read: "success", toCheck: 0 }), null);
  });

  test("the polled payload carries no item to check: the inbox stays out of the 30-second poll", () => {
    assert.deepEqual(Object.keys(reservationPollSchema.shape).sort(), [
      "counts",
      "latestReservation",
      "pendingCount",
      "pendingReservations",
      "pendingSupplierInvoices",
      "timestamp",
      "totalCount",
    ]);
  });
});

describe("the read belongs to its store", () => {
  test("another store's cached read never answers for this one", () => {
    const client = new QueryClient();
    client.setQueryData(needsALookQueries.summary("store_a").queryKey, summary(3));
    assert.equal(client.getQueryData(needsALookQueries.summary("store_b").queryKey), undefined);
    assert.notDeepEqual(
      needsALookQueries.summaryKey("store_a"),
      needsALookQueries.summaryKey("store_b"),
    );
  });
});
