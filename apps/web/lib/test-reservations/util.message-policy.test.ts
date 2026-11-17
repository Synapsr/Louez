import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addTestReservationBanner,
  addTestReservationSubjectPrefix,
  isWithheldForTestReservation,
  planDispatch,
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

  test("whose reservation could not be read sends the e-mail only, unmarked", () => {
    assert.deepEqual(planDispatch("unknown"), { send: true, emailOnly: true, mark: null });
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
