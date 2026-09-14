import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

import { type Locale, defaultLocale, locales } from "./config";

const isLocale = (value: string | null | undefined): value is Locale =>
  Boolean(value) && (locales as readonly string[]).includes(value as string);

/** The first supported language the browser asks for, or null when it names none. */
function getPreferredLocaleFromHeader(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;

  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, quality = "q=1"] = lang.trim().split(";");
      const q = parseFloat(quality.replace("q=", "")) || 1;
      return { code: code.toLowerCase().split("-")[0], q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { code } of languages) {
    if (isLocale(code)) return code;
  }

  return null;
}

/**
 * The fallback language the store owner chose for the storefront, when the
 * request is one. The proxy names the store in `x-store-slug` for every
 * storefront rewrite; the read is React-cached and shared with the layout.
 */
async function getStoreDefaultLocale(headerStore: Headers): Promise<Locale | null> {
  const slug = headerStore.get("x-store-slug");
  if (!slug) return null;

  const store = await getStoreBySlug(slug);
  const locale = store?.settings?.locale;
  return isLocale(locale) ? locale : null;
}

/**
 * Locale of the request, by precedence: the visitor's explicit choice (the
 * `NEXT_LOCALE` cookie set by the language switcher), the browser's
 * `Accept-Language` — an English visitor of a French store reads English
 * from the first screen — then the store's fallback language, then the
 * platform default. A crawler sends neither cookie nor preference, so a
 * store with a fallback language is indexed in that language.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;

  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (getPreferredLocaleFromHeader(headerStore.get("Accept-Language")) ??
      (await getStoreDefaultLocale(headerStore)) ??
      defaultLocale);

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
