import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addTestReservationBanner,
  addTestReservationSubjectPrefix,
  isWithheldForTestReservation,
  planDispatch,
  planDispatchWithRetries,
  planOutboxRow,
  type ReservationMessagePolicy,
} from "./util.message-policy";

const mark = { subjectPrefix: "[Test] ", banner: "Test", recipient: "member@example.test" };
const real: ReservationMessagePolicy = { kind: "real" };
const missing: ReservationMessagePolicy = { kind: "missing" };
const testPolicy: ReservationMessagePolicy = { kind: "test", mark };

describe("an outbox row, by its reservation", () => {
  test("of an ordinary reservation goes as it is, whatever its channel", () => {
    for (const [type, payload] of [
      ["reservation.storeNotification", { channel: "sms" }],
      ["reservation.platformNotification", {}],
      ["reservation.confirmationEmail", { to: "customer@example.test" }],
    ] as const) {
      assert.deepEqual(planOutboxRow(real, type, payload), { send: true, mark: null }, type);
    }
  });

  test("of a reservation gone is skipped, e-mails too", () => {
    for (const type of ["reservation.confirmationEmail", "reservation.storeNotification"]) {
      const plan = planOutboxRow(missing, type, { channel: "email" });
      assert.equal(plan.send, false, type);
    }
  });

  test("of a test reservation sends its e-mails marked, and nothing else", () => {
    assert.deepEqual(
      planOutboxRow(testPolicy, "reservation.storeNotification", { channel: "email" }),
      { send: true, mark },
    );
    assert.equal(
      planOutboxRow(testPolicy, "reservation.storeNotification", { channel: "push" }).send,
      false,
    );
    assert.equal(planOutboxRow(testPolicy, "reservation.platformNotification", {}).send, false);
  });
});

describe("a one-shot send, by its reservation", () => {
  test("of an ordinary reservation uses every channel, unmarked", () => {
    assert.deepEqual(planDispatch(real), { send: true, emailOnly: false, mark: null });
  });

  test("of a reservation gone sends nothing", () => {
    assert.equal(planDispatch(missing).send, false);
  });

  test("of a test reservation sends e-mail only, marked to its member", () => {
    assert.deepEqual(planDispatch(testPolicy), { send: true, emailOnly: true, mark });
  });
});

describe("a one-shot send whose policy read fails", () => {
  const reads = (outcomes: Array<ReservationMessagePolicy | Error>) => {
    const state = { calls: 0, waits: [] as number[], unreadable: [] as unknown[] };
    const read = async () => {
      const outcome = outcomes[state.calls++];
      if (!outcome || outcome instanceof Error) throw outcome ?? new Error("no outcome");
      return outcome;
    };
    const options = {
      onUnreadable: (error: unknown) => state.unreadable.push(error),
      wait: async (ms: number) => {
        state.waits.push(ms);
      },
    };
    return { state, read, options };
  };

  test("reads it again after 100 then 400 ms, and follows the read that succeeds", async () => {
    const { state, read, options } = reads([
      new Error("lost connection"),
      new Error("lost connection"),
      testPolicy,
    ]);
    assert.deepEqual(await planDispatchWithRetries(read, options), {
      send: true,
      emailOnly: true,
      mark,
    });
    assert.equal(state.calls, 3);
    assert.deepEqual(state.waits, [100, 400]);
    assert.deepEqual(state.unreadable, []);
  });

  test("reads it once when the first read succeeds", async () => {
    const { state, read, options } = reads([missing]);
    assert.equal((await planDispatchWithRetries(read, options)).send, false);
    assert.equal(state.calls, 1);
    assert.deepEqual(state.waits, []);
  });

  test("unreadable three times, goes out as a real reservation's, every channel, and is reported", async () => {
    const last = new Error("third failure");
    const { state, read, options } = reads([new Error("first"), new Error("second"), last]);
    assert.deepEqual(await planDispatchWithRetries(read, options), {
      send: true,
      emailOnly: false,
      mark: null,
    });
    assert.equal(state.calls, 3);
    assert.deepEqual(state.unreadable, [last]);
  });
});

describe("a test reservation's outbox rows", () => {
  test("withholds platform notices, analytics, SMS and every channel but e-mail", () => {
    for (const type of [
      "reservation.platformNotification",
      "reservation.createdPlatformNotification",
      "reservation.statusAnalytics",
      "reservation.notesAnalytics",
      "sms.prepaidDebit",
    ]) {
      assert.equal(isWithheldForTestReservation(type, {}), true, type);
    }
    assert.equal(
      isWithheldForTestReservation("reservation.customerMessage", { channel: "sms" }),
      true,
    );
    for (const channel of ["sms", "push", "discord"]) {
      assert.equal(
        isWithheldForTestReservation("reservation.storeNotification", { channel }),
        true,
        channel,
      );
    }
  });

  test("sends e-mails", () => {
    assert.equal(
      isWithheldForTestReservation("reservation.customerMessage", { channel: "email" }),
      false,
    );
    for (const type of [
      "reservation.modifiedEmail",
      "reservation.quoteEmail",
      "reservation.confirmationEmail",
    ]) {
      assert.equal(isWithheldForTestReservation(type, { to: "owner@example.test" }), false, type);
    }
  });
});

describe("a test reservation's e-mail", () => {
  test("starts its subject with the prefix, once", () => {
    const once = addTestReservationSubjectPrefix("Réservation confirmée", "[Test] ");
    assert.equal(once, "[Test] Réservation confirmée");
    assert.equal(addTestReservationSubjectPrefix(once, "[Test] "), once);
  });

  test("puts the banner first in its body, once, escaped", () => {
    const html = '<!DOCTYPE html><html><body style="margin:0"><p>Bonjour</p></body></html>';
    const marked = addTestReservationBanner(html, "Test <b>&</b>");
    assert.match(marked, /<body style="margin:0"><div data-test-reservation="1"/);
    assert.match(marked, /Test &lt;b&gt;&amp;&lt;\/b&gt;<\/div><p>Bonjour<\/p>/);
    assert.equal(addTestReservationBanner(marked, "Test"), marked);
  });

  test("gets the banner even without a body tag", () => {
    assert.match(addTestReservationBanner("<p>Hi</p>", "Test"), /^<div data-test-reservation="1"/);
  });
});
