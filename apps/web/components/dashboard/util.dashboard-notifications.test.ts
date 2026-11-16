import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { reservationPollSchema } from "@louez/api/contracts/reservations";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import type { NeedsALook, NeedsALookItem } from "@/lib/inbox/needs-a-look";
import type { DisplayFormat } from "@/lib/inbox/needs-a-look-display";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";
import type { PublicEnv } from "@/lib/validators/validator.public-env";

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

/** Any instant but the epoch, so a rule that forgot the last answer's time shows. */
const NOW = Date.UTC(2026, 10, 16, 9);

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
  test("the polled counts plus the items to check, capped at 9+", () => {
    assert.equal(notificationsBadge({ polled: 2, toCheck: 3 }), "5");
    assert.equal(notificationsBadge({ polled: 0, toCheck: 3 }), "3");
    assert.equal(notificationsBadge({ polled: 6, toCheck: 3 }), "9");
    assert.equal(notificationsBadge({ polled: 7, toCheck: 3 }), "9+");
    assert.equal(notificationsBadge({ polled: 0, toCheck: 0 }), null);
  });

  test("the inbox never holds the badge back: loading, paused, failed or refused, the polled counts show", () => {
    for (const read of [
      { status: "pending" },
      { status: "error" },
      // A refetch refused (rights removed meanwhile) keeps the earlier answer in `data`.
      { status: "error", data: summary(3) },
    ] as const) {
      const toCheck = needsALookInBell(read, format)?.count ?? 0;
      assert.equal(notificationsBadge({ polled: 2, toCheck }), "2");
      assert.equal(notificationsBadge({ polled: 0, toCheck }), null);
    }
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
  test("the request names the store of its key, whatever the session's active store", async (t) => {
    // The RPC link reads the app's address from the provider's configuration.
    PublicEnvProvider({
      children: null,
      config: { NEXT_PUBLIC_APP_URL: "https://app.louez.test" } as PublicEnv,
    });
    const stores: Array<string | null> = [];
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      stores.push(request.headers.get("louez-store"));
      return new Response(JSON.stringify({ json: { items: [], hasMore: false } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const client = new QueryClient();
    await client.fetchQuery(needsALookQueries.summary("store_a"));
    await client.fetchQuery(needsALookQueries.summary("store_b"));
    assert.deepEqual(stores, ["store_a", "store_b"]);
    client.clear();
  });

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

describe("the items are read again, as other screens settle them", () => {
  test("on a new page once the answer is a minute old, always when the bell opens, and for this store only", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const client = new QueryClient();
    let reads = 0;
    await client.fetchQuery({
      queryKey: needsALookQueries.summaryKey("store_a"),
      queryFn: async () => {
        reads += 1;
        return summary(1);
      },
    });

    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 1);
    await needsALookQueries.readAgain(client, "store_a", { always: true });
    assert.equal(reads, 2);
    await needsALookQueries.readAgain(client, "store_b", { always: true });
    assert.equal(reads, 2);

    // The minute runs from the last answer, not from the first.
    t.mock.timers.tick(59_999);
    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 2);
    t.mock.timers.tick(1);
    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 3);
    client.clear();
  });

  test("a read on its way is left to finish, not started again", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const client = new QueryClient();
    let reads = 0;
    let answer: (value: NeedsALook) => void = () => {};
    const key = needsALookQueries.summaryKey("store_a");
    const queryFn = () => {
      reads += 1;
      return reads === 1
        ? Promise.resolve(summary(1))
        : new Promise<NeedsALook>((r) => (answer = r));
    };
    await client.fetchQuery({ queryKey: key, queryFn });

    const first = needsALookQueries.readAgain(client, "store_a", { always: true });
    const second = needsALookQueries.readAgain(client, "store_a", { always: true });
    answer(summary(2));
    await Promise.all([first, second]);
    assert.equal(reads, 2);
    assert.equal(client.getQueryData<NeedsALook>(key)?.items.length, 2);
    client.clear();
  });

  test("a failed read stands a minute too: a refusal is not asked again on every page", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const client = new QueryClient();
    let reads = 0;
    const query = {
      queryKey: needsALookQueries.summaryKey("store_a"),
      queryFn: async () => {
        reads += 1;
        if (reads > 1) throw new Error("refused");
        return summary(1);
      },
      retry: false,
    };
    await client.fetchQuery(query);

    // An old answer, then a refusal: the minute runs from the refusal.
    t.mock.timers.tick(60_000);
    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 2);
    t.mock.timers.tick(59_999);
    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 2);
    t.mock.timers.tick(1);
    await needsALookQueries.readAgain(client, "store_a");
    assert.equal(reads, 3);
    client.clear();
  });
});
