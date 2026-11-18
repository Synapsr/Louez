import assert from "node:assert/strict";
import test from "node:test";

import { readVisitSource, withVisitSource } from "./util.visit-source";

test("marks a storefront link with its channel", () => {
  assert.equal(withVisitSource("https://velos.louez.io", "qr"), "https://velos.louez.io/?via=qr");
  assert.equal(
    withVisitSource("https://velos.louez.io/product/vtt?color=red#photos", "whatsapp"),
    "https://velos.louez.io/product/vtt?color=red&via=whatsapp#photos",
  );
});

test("replaces a channel already on the link", () => {
  assert.equal(
    withVisitSource("https://velos.louez.io/?via=qr", "google"),
    "https://velos.louez.io/?via=google",
  );
});

test("leaves a link it cannot parse as it is", () => {
  assert.equal(withVisitSource("/relative", "sms"), "/relative");
});

test("reads only the channels of the closed list", () => {
  assert.equal(readVisitSource("?via=qr"), "qr");
  assert.equal(readVisitSource("?foo=1&via=facebook"), "facebook");
  assert.equal(readVisitSource("?via=tiktok"), null);
  assert.equal(readVisitSource("?ref=qr"), null);
  assert.equal(readVisitSource(""), null);
});
