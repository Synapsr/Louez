import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import type { McpSessionContext } from "../auth/context";
import type { McpStatusChangeInput, McpStatusChangeResult } from "../deps";
import {
  connectReservationTools,
  type ReservationToolsClient,
} from "../testing/reservation-tools-client";

// The MCP status tool hands the change to the app, which does what the
// dashboard does (apps/web/lib/reservations/status-change.db.test.ts). Here: what
// it sends and what it answers.

const ctx: McpSessionContext = {
  storeId: "store_mcp",
  userId: "user_mcp",
  storeName: "MCP store",
  apiKeyId: "key_mcp",
  permissions: {
    reservations: "write",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  },
};

describe("MCP status tool", () => {
  let client: ReservationToolsClient;
  let readOnly: ReservationToolsClient;
  let calls: McpStatusChangeInput[] = [];
  let answer: McpStatusChangeResult;

  before(async () => {
    const deps = {
      changeReservationStatus: async (input: McpStatusChangeInput) => {
        calls.push(input);
        return answer;
      },
    };
    client = await connectReservationTools(ctx, deps);
    readOnly = await connectReservationTools(
      { ...ctx, permissions: { ...ctx.permissions, reservations: "read" } },
      deps,
    );
  });

  after(async () => {
    await client?.close();
    await readOnly?.close();
  });

  beforeEach(() => {
    calls = [];
    answer = { ok: true, number: "R-1", from: "pending", to: "confirmed", warnings: [] };
  });

  const updateStatus = (args: Record<string, unknown>) =>
    client.call("update_reservation_status", args);

  test("hands the change to the app as the key's user, and says what changed", async () => {
    assert.deepEqual(
      await updateStatus({ reservationId: "res_1", status: "rejected", rejectionReason: "Full" }),
      { text: "Reservation #R-1 updated: Pending → Confirmed", isError: false },
    );
    assert.deepEqual(calls, [
      {
        storeId: "store_mcp",
        reservationId: "res_1",
        to: "rejected",
        actor: "mcp",
        actorUserId: "user_mcp",
        rejectionReason: "Full",
      },
    ]);
  });

  test("lists the warnings the dashboard would show", async () => {
    answer = {
      ok: true,
      number: "R-2",
      from: "pending",
      to: "confirmed",
      warnings: [
        { key: "errors.advanceNoticeViolation", params: { hours: 24 } },
        { key: "errors.tulipContractCreationFailed" },
      ],
    };

    assert.deepEqual(await updateStatus({ reservationId: "res_2", status: "confirmed" }), {
      text: 'Reservation #R-2 updated: Pending → Confirmed\nWarnings: errors.advanceNoticeViolation {"hours":24}, errors.tulipContractCreationFailed',
      isError: false,
    });
  });

  test("answers a missing reservation and a refusal as errors", async () => {
    answer = { ok: false, error: "not_found" };
    assert.deepEqual(await updateStatus({ reservationId: "res_3", status: "confirmed" }), {
      text: "Reservation not found.",
      isError: true,
    });

    answer = {
      ok: false,
      error: "refused",
      message: "Invalid transition: completed → confirmed. Allowed: none",
    };
    assert.deepEqual(await updateStatus({ reservationId: "res_3", status: "confirmed" }), {
      text: "Invalid transition: completed → confirmed. Allowed: none",
      isError: true,
    });
  });

  test("refuses a rejection reason over the dashboard's limit before the app runs", async () => {
    const { text, isError } = await updateStatus({
      reservationId: "res_4",
      status: "rejected",
      rejectionReason: "x".repeat(2001),
    });

    assert.equal(isError, true);
    assert.match(text, /Input validation error/);
    assert.deepEqual(calls, []);
  });

  test("a read-only key cannot change a status", async () => {
    const { text, isError } = await readOnly.call("update_reservation_status", {
      reservationId: "res_5",
      status: "confirmed",
    });

    assert.equal(isError, true);
    assert.match(text, /Permission denied: requires reservations:write/);
    assert.deepEqual(calls, []);
  });
});
