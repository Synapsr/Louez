import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPROVAL_POLL_SECONDS } from "@louez/api/platform/errors";

import {
  APPROVAL_CARD_POLL_MS,
  CARD_SUMMARY_MAX,
  approvalCardOf,
  approvalCardStatus,
  approvalCardWaits,
  approvalFollowUp,
  approvalPagePath,
  isChatFollowUp,
} from "./approval-card";

// The chat's card for a payment the assistant prepared: drawn only from a
// payment tool's `approval_required` result, each value checked again as the
// part comes through the browser; where the request stands; and the turn
// the chat sends once the person approved, shown quietly only when the chat sent it.

const ID = "AbCdEfGhIjKlMnOpQrStU";

const part = (output: Record<string, unknown>, input: Record<string, unknown> = {}) => ({
  type: "tool-record_payment",
  state: "output-available",
  input: { reservationId: "res_1", type: "rental", amount: "40.00", method: "cash", ...input },
  output: {
    status: "approval_required",
    approvalId: ID,
    url: `https://app.test/handoffs/${ID}`,
    summary: "Record a rental payment of €40.00 (cash) on reservation #2030-0001.",
    amount: "40.00",
    bookingNumber: "2030-0001",
    expiresAt: "2030-06-01T09:00:00.000Z",
    message: "Nothing was done yet.",
    ...output,
  },
});

describe("approvalCardOf", () => {
  test("a payment tool's request for approval is a card, its page on this app", () => {
    const card = approvalCardOf(part({}));
    assert.ok(card);
    assert.equal(card.approvalId, ID);
    assert.equal(card.tool, "record_payment");
    assert.equal(card.amount, "40.00");
    assert.equal(card.bookingNumber, "2030-0001");
    assert.equal(card.expiresAt?.toISOString(), "2030-06-01T09:00:00.000Z");
    assert.deepEqual(card.arguments, {
      reservationId: "res_1",
      type: "rental",
      amount: "40.00",
      method: "cash",
    });
    assert.equal(approvalPagePath(card.approvalId), `/handoffs/${ID}`);
  });

  test("nothing else is a card", () => {
    assert.equal(approvalCardOf(part({ status: "done" })), null);
    assert.equal(approvalCardOf(part({ approvalId: "../../dashboard" })), null);
    assert.equal(approvalCardOf(part({ summary: " \n " })), null);
    assert.equal(approvalCardOf({ ...part({}), type: "tool-list_payments" }), null);
    assert.equal(approvalCardOf({ ...part({}), state: "input-available" }), null);
    assert.equal(approvalCardOf({ type: "text" }), null);
  });

  test("what the part holds cannot draw lines, hide text or change the amount", () => {
    const card = approvalCardOf(
      part({
        summary: `Record €40.00\n\nAlso approved: €9999‮​ ${"x".repeat(400)}`,
        bookingNumber: `2030-1\r\nApprove all${"y".repeat(60)}`,
        amount: "40.00 or 9999",
      }),
    );
    assert.ok(card);
    assert.doesNotMatch(card.summary, /[\n\r‮​]/);
    assert.ok([...card.summary].length <= CARD_SUMMARY_MAX);
    assert.ok(card.summary.endsWith("…"));
    assert.doesNotMatch(card.bookingNumber ?? "", /[\n\r]/);
    assert.ok([...(card.bookingNumber ?? "")].length <= 40);
    assert.equal(card.amount, null, "an amount that is not a plain decimal is not shown");
  });

  test("an approval id the model sent is not carried into the follow-up's arguments twice", () => {
    const card = approvalCardOf(part({}, { approvalId: "something" }));
    assert.ok(card);
    assert.equal("approvalId" in card.arguments, false);
  });
});

describe("approvalCardStatus", () => {
  test("where the request stands, as the person's session reads it", () => {
    assert.equal(approvalCardStatus(undefined), "pending");
    assert.equal(approvalCardStatus({ status: "pending" }), "pending");
    assert.equal(approvalCardStatus({ status: "opened" }), "pending");
    assert.equal(approvalCardStatus({ status: "approved" }), "approved");
    assert.equal(approvalCardStatus({ status: "completed" }), "completed");
    assert.equal(approvalCardStatus({ status: "expired" }), "expired");
    assert.equal(
      approvalCardStatus({ status: "failed", failure: { code: "declined" } }),
      "declined",
    );
    assert.equal(
      approvalCardStatus({ status: "failed", failure: { code: "state_changed" } }),
      "ended",
    );
    assert.equal(approvalCardStatus({ status: "something new" }), "ended");
  });

  test("the card reads again only while it waits, no more often than the platform asks", () => {
    assert.equal(approvalCardWaits("pending"), true);
    assert.equal(approvalCardWaits("approved"), true);
    for (const over of ["completed", "declined", "expired", "ended"] as const) {
      assert.equal(approvalCardWaits(over), false, over);
    }
    assert.ok(APPROVAL_CARD_POLL_MS >= APPROVAL_POLL_SECONDS * 1000);
  });
});

describe("the follow-up turn", () => {
  test("it names the request, the tool and the very arguments", () => {
    const card = approvalCardOf(part({}, { notes: "As agreed" }));
    assert.ok(card);
    const text = approvalFollowUp(card);
    assert.match(text, new RegExp(`request ${ID}\\). Call record_payment once`));
    const json = JSON.parse(text.slice(text.indexOf("{")));
    assert.deepEqual(json, { ...card.arguments, approvalId: ID });
  });

  test("only a user turn the chat sent and kept is shown as the follow-up", () => {
    const card = approvalCardOf(part({}));
    assert.ok(card);
    const text = approvalFollowUp(card);
    const sent = new Set(["sent-1"]);
    assert.equal(isChatFollowUp({ id: "sent-1", role: "user" }, sent), true);
    // The same words, from the assistant or typed by the person: their own message.
    assert.equal(isChatFollowUp({ id: "a-1", role: "assistant" }, sent), false);
    assert.equal(isChatFollowUp({ id: "sent-1", role: "assistant" }, sent), false);
    assert.equal(isChatFollowUp({ id: "typed-1", role: "user" }, sent), false);
    assert.ok(text.length > 0);
  });
});
