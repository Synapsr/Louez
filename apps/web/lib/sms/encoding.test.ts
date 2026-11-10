import assert from "node:assert/strict";
import { test } from "node:test";

import { fitSmsSegments, requiresUnicode, smsSegments } from "./encoding";

test("GSM 7-bit fits 160 characters in one SMS, 153 per segment beyond", () => {
  assert.equal(requiresUnicode("Réservation #12 annulée"), false, "é is GSM 7-bit");
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("a".repeat(306)), 2);
  assert.equal(smsSegments("a".repeat(307)), 3);
  // An extended character takes two septets.
  assert.equal(smsSegments("€".repeat(80)), 1);
  assert.equal(smsSegments("€".repeat(81)), 2);
});

test("any other character makes it UCS-2: 70 in one SMS, 67 per segment beyond", () => {
  assert.equal(requiresUnicode("Reserva cancelada: contáctenos"), true, "á is not GSM 7-bit");
  assert.equal(smsSegments("预".repeat(70)), 1);
  assert.equal(smsSegments("预".repeat(71)), 2);
  // An emoji is two UTF-16 code units.
  assert.equal(smsSegments("🛶".repeat(35)), 1);
  assert.equal(smsSegments("🛶".repeat(36)), 2);
});

test("a text that fits is sent as it is", () => {
  const text = `Kayaks\n${"word ".repeat(90).trim()}`;
  assert.equal(smsSegments(text), 3);
  assert.equal(fitSmsSegments(text), text);
});

test("a longer GSM text is cut at a word to three segments, and says so", () => {
  const text = `Kayaks\n${"paddle ".repeat(100).trim()}`;
  const fitted = fitSmsSegments(text);
  assert.equal(smsSegments(fitted), 3);
  assert.ok(fitted.length <= 459);
  assert.match(fitted, /paddle\.\.\.$/, "cut after a whole word");
  assert.ok(text.startsWith(fitted.slice(0, -3)));
});

test("a longer UCS-2 text is held to 201 code units, never splitting a character", () => {
  const fitted = fitSmsSegments("🛶".repeat(200));
  assert.equal(smsSegments(fitted), 3);
  assert.ok(fitted.length <= 201);
  assert.match(fitted, /^(🛶)+\.\.\.$/u, "only whole emojis, then the ellipsis");

  const words = fitSmsSegments(`Réserva ${"contáctenos ".repeat(40).trim()}`);
  assert.equal(smsSegments(words), 3);
  assert.match(words, /contáctenos\.\.\.$/);
});

test("one word longer than the budget is cut where it must", () => {
  const fitted = fitSmsSegments(`Pay: https://pay.example.test/${"x".repeat(600)}`);
  assert.equal(smsSegments(fitted), 3);
  assert.equal(fitted.length, 459);
});
