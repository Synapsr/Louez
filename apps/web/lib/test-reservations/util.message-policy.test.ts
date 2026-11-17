import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addTestReservationBanner,
  addTestReservationSubjectPrefix,
  isWithheldForTestReservation,
} from "./util.message-policy";

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
