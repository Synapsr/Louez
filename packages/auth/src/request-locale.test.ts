import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// The shared locale registry is CommonJS; use tsx's require hook across packages.
const { getLocaleFromHeaders }: typeof import("./request-locale") = createRequire(import.meta.url)(
  "./request-locale",
);

test("reads the e-mail locale from the browser language", () => {
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "de-DE,de;q=0.9" })), "de");
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "PT-br" })), "pt");
});

test("falls back to French for an unsupported or missing language", () => {
  assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": "ar" })), "fr");
  assert.equal(getLocaleFromHeaders(new Headers()), "fr");
});

test("auth follows all new languages and respects the explicit app language", () => {
  for (const locale of ["zh", "ja", "ru", "id", "ko"]) {
    assert.equal(getLocaleFromHeaders(new Headers({ "accept-language": locale })), locale);
    assert.equal(
      getLocaleFromHeaders(
        new Headers({ cookie: `NEXT_LOCALE=${locale}`, "accept-language": "fr" }),
      ),
      locale,
    );
  }
  assert.equal(
    getLocaleFromHeaders(new Headers({ "accept-language": "fr;q=0,ja;q=0.9,en;q=0.5" })),
    "ja",
  );
});
