import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REDACTED, Redactor, isApiKey, isSecretLike } from "./secrets.js";

const KEY = "lz_ab12_AbCdEfGhIjKlMnOpQrSt";

describe("the key's format", () => {
  test("is the one Louez issues: lz_, 4 lowercase letters or digits, _, 20 letters or digits", () => {
    assert.ok(isApiKey(KEY));
    for (const value of [
      "",
      "1",
      "lz_",
      "lz_AB12_AbCdEfGhIjKlMnOpQrSt",
      `${KEY}x`,
      KEY.slice(0, -1),
      "lz_ab12-AbCdEfGhIjKlMnOpQrSt",
    ]) {
      assert.ok(!isApiKey(value), value);
    }
  });

  test("only keys, and values that start like one, are secrets", () => {
    assert.ok(isSecretLike(KEY));
    assert.ok(isSecretLike("lz_ab12_AbCd"));
    for (const value of ["1", "0", "true", "--version", "lz_ab"])
      assert.ok(!isSecretLike(value), value);
  });
});

describe("the redactor", () => {
  test("ignores what is no secret, so counts and versions stay whole", () => {
    const redactor = new Redactor();
    redactor.add("1");
    redactor.add("");
    assert.equal(redactor.text('{"count":1} louez 0.1.0'), '{"count":1} louez 0.1.0');
  });

  test("hides the key as is, with any of its characters percent-encoded, and in base64 at any alignment", () => {
    const redactor = new Redactor();
    redactor.add(KEY);
    const pct = (text: string) => [...text].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("");
    for (const form of [
      KEY,
      `lz%5Fab12%5F${KEY.slice(8)}`,
      pct(KEY),
      `${pct(KEY.slice(0, 5))}${KEY.slice(5)}`,
      Buffer.from(KEY).toString("base64"),
      Buffer.from(KEY).toString("base64url").replace(/=+$/, ""),
      Buffer.from(`Bearer ${KEY}`).toString("base64"),
      Buffer.from(`x${KEY}`).toString("base64"),
      Buffer.from(`xy${KEY}z`).toString("base64url"),
    ]) {
      const out = redactor.text(`before ${form} after`);
      assert.ok(out.includes(REDACTED), form);
      assert.ok(!out.includes(form), form);
    }
  });

  test("redacts JSON by value: the shape stays, numbers stay", () => {
    const redactor = new Redactor();
    redactor.add(KEY);
    assert.deepEqual(redactor.value({ [KEY]: [`Bearer ${KEY}`, 1, true, null] }), {
      [REDACTED]: [`Bearer ${REDACTED}`, 1, true, null],
    });
  });
});
