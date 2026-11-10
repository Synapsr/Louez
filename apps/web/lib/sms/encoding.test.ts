import assert from "node:assert/strict";
import { test } from "node:test";

import { fitSmsSegments, requiresUnicode, smsSegments } from "./encoding";

test("one SMS holds 160 GSM 7-bit characters, or 70 UCS-2 units", () => {
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("预".repeat(70)), 1);
  assert.equal(smsSegments("预".repeat(71)), 2);
  // An extension character is an escape and itself: two septets.
  assert.equal(smsSegments("€".repeat(80)), 1);
  assert.equal(smsSegments("€".repeat(81)), 2);
  // An emoji outside the basic plane is two UCS-2 units.
  assert.equal(smsSegments("🛶".repeat(35)), 1);
  assert.equal(smsSegments("🛶".repeat(36)), 2);
});

test("segments are packed a character at a time: 153 septets or 67 units each", () => {
  assert.equal(smsSegments("a".repeat(306)), 2);
  assert.equal(smsSegments("a".repeat(307)), 3);
  assert.equal(smsSegments("预".repeat(134)), 2);
  assert.equal(smsSegments("预".repeat(135)), 3);
  // 100 emojis: 33 to a segment (66 units, the 67th cannot hold half of one): 4, not 3.
  assert.equal(smsSegments("🛶".repeat(100)), 4);
  // 229 €: 76 to a segment (152 septets, the 153rd cannot hold an escape pair): 4, not 3.
  assert.equal(smsSegments("€".repeat(229)), 4);
  assert.equal(smsSegments("€".repeat(228)), 3);
});

test("the whole GSM 03.38 tables are 7-bit, form feed among the extension", () => {
  for (const char of "ÉÆæßÇÅåØøΔΦΓΛΩΠΨΣΘΞ¡¿§¤£¥ÄÖÑÜäöñüàèéùìò@$_\n\r") {
    assert.equal(requiresUnicode(char), false, char);
  }
  assert.equal(smsSegments(`É${"a".repeat(159)}`), 1, "É + 159 ASCII is one SMS");
  assert.equal(smsSegments(`Æß${"a".repeat(158)}`), 1);
  assert.equal(requiresUnicode("\f"), false);
  assert.equal(smsSegments("\f".repeat(80)), 1, "form feed is an extension character");
  assert.equal(smsSegments("\f".repeat(81)), 2);
  for (const char of ["ç", "á", "’", "…", " ", "\t"]) {
    assert.equal(requiresUnicode(char), true, `${JSON.stringify(char)} is not GSM 7-bit`);
  }
});

test("a text that fits is sent as it is", () => {
  const text = `Kayaks\n${"word ".repeat(90).trim()}`;
  assert.equal(smsSegments(text), 3);
  assert.equal(fitSmsSegments(text), text);
});

test("200 emojis are cut to what three segments hold with the ellipsis", () => {
  const fitted = fitSmsSegments("🛶".repeat(200));
  // 33 + 33, then 32 and "..." in the last 67 units (64 + 3).
  assert.equal(fitted, `${"🛶".repeat(98)}...`);
  assert.equal(smsSegments(fitted), 3);
  assert.equal(smsSegments(`${"🛶".repeat(99)}...`), 4, "one more would take a fourth");
});

test("escape pairs are cut to what three segments hold with the ellipsis", () => {
  const fitted = fitSmsSegments("€".repeat(300));
  assert.equal(smsSegments(fitted), 3);
  // 76 + 76, then 75 and "..." in the last 153 septets (150 + 3).
  assert.equal(fitted, `${"€".repeat(227)}...`);
  assert.equal(smsSegments(`${"€".repeat(228)}...`), 4, "one more would take a fourth");
});

test("a longer GSM text is cut after a whole word, and says so", () => {
  const text = `Kayaks\n${"paddle ".repeat(100).trim()}`;
  const fitted = fitSmsSegments(text);
  assert.equal(smsSegments(fitted), 3);
  assert.ok(fitted.length <= 459);
  assert.match(fitted, /paddle\.\.\.$/);
  assert.ok(text.startsWith(fitted.slice(0, -3)));
});

test("a longer UCS-2 text is cut after a whole word, an emoji kept whole", () => {
  const words = fitSmsSegments(`Réserva ${"contáctenos 👍🏽 ".repeat(30).trim()}`);
  assert.equal(smsSegments(words), 3);
  assert.match(words, /(contáctenos|👍🏽)\.\.\.$/u);
});

test("one word longer than the budget is cut where it must", () => {
  const fitted = fitSmsSegments(`Pay: https://pay.example.test/${"x".repeat(600)}`);
  assert.equal(smsSegments(fitted), 3);
  assert.equal(fitted.length, 459);
});
