import assert from "node:assert/strict";
import { test } from "node:test";

import { format } from "date-fns";

import { resolveFormatLocale } from "@/lib/i18n/format-locale";

const SAMPLE_DATE = new Date("2026-08-27T12:00:00.000Z");

test("formats dates in the active request locale", () => {
  const locale = resolveFormatLocale("de");

  assert.equal(locale.intl, "de-DE");
  assert.equal(
    format(SAMPLE_DATE, "EEEE, d. MMMM", { locale: locale.dateFns }),
    "Donnerstag, 27. August",
  );
});

test("uses a regional override for the active language", () => {
  const locale = resolveFormatLocale("de", "de-at");

  assert.equal(locale.intl, "de-AT");
  assert.equal(locale.dateFns.code, "de-AT");
});

test("uses the configured locale when no request locale is available", () => {
  assert.equal(resolveFormatLocale(undefined, "de-AT").intl, "de-AT");
});

test("accepts a supported full locale from callers", () => {
  const locale = resolveFormatLocale("pt-BR");

  assert.equal(locale.intl, "pt-BR");
  assert.equal(locale.dateFns.code, "pt-BR");
});

test("uses the configured region for every supported request locale", () => {
  assert.deepEqual(
    ["fr", "en", "it", "nl", "pt", "de", "es", "pl"].map((activeLocale) => {
      const resolved = resolveFormatLocale(activeLocale);
      return [activeLocale, resolved.intl, resolved.dateFns.code];
    }),
    [
      ["fr", "fr-FR", "fr"],
      ["en", "en-GB", "en-GB"],
      ["it", "it-IT", "it"],
      ["nl", "nl-NL", "nl"],
      ["pt", "pt-PT", "pt"],
      ["de", "de-DE", "de"],
      ["es", "es-ES", "es"],
      ["pl", "pl-PL", "pl"],
    ],
  );
});

test("falls back safely when the regional override is unusable", () => {
  assert.deepEqual(
    ["not_a_locale", "de", "fr-FR"].map(
      (regionalOverride) => resolveFormatLocale("de", regionalOverride).intl,
    ),
    ["de-DE", "de-DE", "de-DE"],
  );
});
