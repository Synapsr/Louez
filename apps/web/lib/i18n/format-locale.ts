import {
  de,
  deAT,
  enGB,
  enUS,
  es,
  fr,
  it,
  nl,
  pl,
  pt,
  ptBR,
  type Locale as DateFnsLocale,
} from "date-fns/locale";

import { defaultLocale, localeCountries, locales, type Locale } from "@/i18n/config";

export interface ResolvedFormatLocale {
  intl: string;
  dateFns: DateFnsLocale;
}

const canonicalizeLocale = (locale: string | undefined): string | undefined => {
  if (!locale) {
    return undefined;
  }

  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
};

export const isLocale = (locale: string): locale is Locale =>
  locales.some((supportedLocale) => supportedLocale === locale);

const DATE_FNS_BY_LOCALE: Record<Locale, DateFnsLocale> = {
  fr,
  en: enGB,
  it,
  nl,
  pt,
  de,
  es,
  pl,
};

const DATE_FNS_BY_REGIONAL_LOCALE: Record<string, DateFnsLocale> = {
  "de-AT": deAT,
  "en-US": enUS,
  "pt-BR": ptBR,
};

export const resolveFormatLocale = (
  locale: string | undefined,
  regionalOverride?: string,
): ResolvedFormatLocale => {
  const canonicalLocale = canonicalizeLocale(locale);
  const requestedLocale = canonicalLocale ? new Intl.Locale(canonicalLocale) : undefined;
  const canonicalOverride = canonicalizeLocale(regionalOverride);
  const overrideLocale = canonicalOverride ? new Intl.Locale(canonicalOverride) : undefined;
  const activeLocale =
    requestedLocale?.language && isLocale(requestedLocale.language)
      ? requestedLocale.language
      : !requestedLocale && overrideLocale?.language && isLocale(overrideLocale.language)
        ? overrideLocale.language
        : defaultLocale;
  const derivedLocale = `${activeLocale}-${localeCountries[activeLocale]}`;
  const matchingRegionalLocale = [canonicalOverride, canonicalLocale].find((candidate) => {
    if (!candidate) {
      return false;
    }

    const parsedLocale = new Intl.Locale(candidate);
    return parsedLocale.region && parsedLocale.language === activeLocale;
  });
  const intl = matchingRegionalLocale ?? derivedLocale;

  return {
    intl,
    dateFns: DATE_FNS_BY_REGIONAL_LOCALE[intl] ?? DATE_FNS_BY_LOCALE[activeLocale],
  };
};
