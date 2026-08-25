import { defaultLocale, locales, localeCountries, type Locale } from "@/i18n/config";

/**
 * BCP 47 tag used by `Intl.*` formatters and `toLocaleString` calls.
 *
 * Formatting was pinned to `fr-FR` across the app, so a German or Spanish
 * instance rendered "jeu. 27 août" next to fully translated labels. It now
 * follows the instance's configured locale.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_FORMAT_LOCALE` — full BCP 47 tag, for a formatting region
 *      that differs from the UI language (e.g. `de-AT` while the UI runs `de`).
 *   2. `NEXT_PUBLIC_DEFAULT_LOCALE` — one of the supported UI locales.
 *   3. `defaultLocale`, which preserves the previous behaviour for instances
 *      that configure neither.
 *
 * Read from `process.env` at module scope: these are build-time public values,
 * and formatting has to stay synchronous for the many non-async call sites.
 */

/** Region comes from the shared locale config so there is one table, not two. */
function withRegion(locale: Locale): string {
  return `${locale}-${localeCountries[locale]}`;
}

function resolve(): string {
  const explicit = process.env.NEXT_PUBLIC_FORMAT_LOCALE?.trim();
  if (explicit) return explicit;

  const configured = process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim();
  if (configured && locales.includes(configured as Locale)) {
    return withRegion(configured as Locale);
  }

  return withRegion(defaultLocale);
}

/** BCP 47 tag for `Intl.*` formatters. */
export const FORMAT_LOCALE = resolve();
