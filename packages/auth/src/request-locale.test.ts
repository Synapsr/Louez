import assert from "node:assert/strict";
import test from "node:test";

import { getLocaleFromHeaders } from "./request-locale";

test("reads the e-mail locale from the browser language", () => {
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "de-DE,de;q=0.9" })), "de");
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "PT-br" })), "pt");
});

test("falls back to French for an unsupported or missing language", () => {
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "ja-JP" })), "fr");
  assert.equal(getLocaleFromHeaders(new Headers()), "fr");
});
