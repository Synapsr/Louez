import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { MAX_DECODED_TOKEN, REDACTED, Redactor, isApiKey } from "./secrets.js";

const KEY = "lz_ab12_AbCdEfGhIjKlMnOpQrSt";

function redactorOf(...values: string[]): Redactor {
  const redactor = new Redactor();
  for (const value of values) redactor.add(value);
  return redactor;
}

describe("the key's format", () => {
  test("is the one Louez issues: lz_, 4 lowercase letters or digits, _, 20 letters or digits", () => {
    assert.ok(isApiKey(KEY));
    for (const value of [
      "",
      "1",
      "lz_",
      "lz_hello",
      "lz_AB12_AbCdEfGhIjKlMnOpQrSt",
      `${KEY}x`,
      KEY.slice(0, -1),
      "lz_ab12-AbCdEfGhIjKlMnOpQrSt",
    ]) {
      assert.ok(!isApiKey(value), value);
    }
  });
});

describe("the redactor", () => {
  test("takes only well-formed keys as secrets: a malformed value hides nothing", () => {
    const redactor = redactorOf("lz_hello", "1", "", KEY);
    // "X2hlbGxv" is base64 of "_hello", a part of the malformed value.
    const text = '{"id":"X2hlbGxv","other":"lz_hello","count":1} louez 0.1.0';
    assert.equal(redactor.text(text), text);
  });

  test("replaces the complete key as is, and percent-encoded in any of its characters", () => {
    const redactor = redactorOf(KEY);
    const encode = (char: string) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
    const forms = [
      KEY,
      encodeURIComponent(KEY),
      [...KEY].map(encode).join(""),
      [...KEY].map(encode).join("").toUpperCase(),
      [...KEY].map((char, i) => (i % 2 === 0 ? encode(char) : char)).join(""),
      KEY.replace(/_/g, "%5F"),
    ];
    for (const form of forms) {
      assert.equal(redactor.text(`key=${form}&next=1`), `key=${REDACTED}&next=1`, form);
    }
    // Only the key: what is beside it in the same run stays.
    assert.equal(redactor.text(`Bearer ${KEY}`), `Bearer ${REDACTED}`);
    assert.equal(redactor.text(`x${KEY}y`), `x${REDACTED}y`);
  });

  test("replaces a whole base64 or base64url text whose bytes hold the complete key", () => {
    const redactor = redactorOf(KEY);
    for (const text of [KEY, `Bearer ${KEY}`, `user:${KEY}`, `ab${KEY}cd and more text`]) {
      for (const encoding of ["base64", "base64url"] as const) {
        const encoded = Buffer.from(text).toString(encoding);
        for (const form of [encoded, encoded.replace(/=+$/, "")]) {
          assert.equal(redactor.text(`"${form}"`), `"${REDACTED}"`, `${encoding} of ${text}`);
        }
      }
    }
  });

  test("leaves ordinary base64 alone: ids, an image, a part of the key", () => {
    const redactor = redactorOf(KEY);
    const image = randomBytes(30_000).toString("base64");
    // All of the key but its last character, inside a longer text: decoded, and no key in it.
    const part = Buffer.from(`prefix ${KEY.slice(0, -1)} suffix`).toString("base64");
    const ids = "X2hlbGxv dXNlcl9pZA== aWRfMTIz";
    for (const text of [image, part, ids]) assert.equal(redactor.text(text), text);
  });

  test("decodes no run longer than its cap, and still finds the key as is in it", () => {
    const redactor = redactorOf(KEY);
    const long = Buffer.from(`${"x".repeat(MAX_DECODED_TOKEN)}${KEY}`).toString("base64");
    assert.equal(redactor.text(long), long);
    const plain = `${"a".repeat(MAX_DECODED_TOKEN)}${KEY}`;
    assert.equal(redactor.text(plain), `${"a".repeat(MAX_DECODED_TOKEN)}${REDACTED}`);
  });

  test("redacts JSON by value, and a property named with the key keeps its value", () => {
    const redactor = redactorOf(KEY);
    assert.deepEqual(redactor.value({ list: [`Bearer ${KEY}`, 1, true, null] }), {
      list: [`Bearer ${REDACTED}`, 1, true, null],
    });
    const renamed = redactor.value({ [KEY]: 1, [REDACTED]: 2, [`Bearer ${KEY}`]: 3 });
    assert.deepEqual(renamed, {
      [`${REDACTED} (2)`]: 1,
      [REDACTED]: 2,
      [`Bearer ${REDACTED}`]: 3,
    });
    const twice = redactor.value({ [KEY]: 1, [encodeURIComponent(KEY).replace("_", "%5F")]: 2 });
    assert.deepEqual(twice, { [REDACTED]: 1, [`${REDACTED} (2)`]: 2 });
  });
});
