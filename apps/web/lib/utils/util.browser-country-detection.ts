import { SUPPORTED_COUNTRIES, getCountryByCode } from '@/lib/utils/countries';

export const ONBOARDING_FALLBACK_COUNTRY = 'FR';

const LANGUAGE_TO_COUNTRY: Record<string, string> = {
  fr: 'FR',
  en: 'US',
  de: 'DE',
  es: 'ES',
  it: 'IT',
  nl: 'NL',
  pl: 'PL',
  pt: 'PT',
  ja: 'JP',
  zh: 'CN',
  ko: 'KR',
};

export interface BrowserCountryDetection {
  country: string;
  source: 'timezone' | 'locale-region' | 'language-map' | 'fallback';
  localeCandidates: string[];
  timezone: string | null;
  matchedLocaleRegion: string | null;
}

function extractRegionCode(locale: string): string | null {
  const normalizedLocale = locale.replace('_', '-');

  try {
    const region = new Intl.Locale(normalizedLocale).region;
    return region?.toUpperCase() ?? null;
  } catch {
    const parts = normalizedLocale.split('-');
    const possibleRegion = parts.at(-1)?.toUpperCase();

    if (!possibleRegion || possibleRegion.length !== 2) {
      return null;
    }

    return possibleRegion;
  }
}

function getBrowserLocaleCandidates(): string[] {
  if (typeof navigator === 'undefined') return [];

  return [navigator.language, ...(navigator.languages ?? [])].filter(
    (locale): locale is string => Boolean(locale),
  );
}

function getBrowserTimezone(): string | null {
  if (typeof Intl === 'undefined') return null;

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function getCountryFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;

  return (
    SUPPORTED_COUNTRIES.find((country) => country.timezone === timezone)?.code ??
    null
  );
}

export function detectCountryFromBrowser(): BrowserCountryDetection {
  const localeCandidates = getBrowserLocaleCandidates();
  const timezone = getBrowserTimezone();
  const timezoneCountry = getCountryFromTimezone(timezone);

  if (timezoneCountry) {
    return {
      country: timezoneCountry,
      source: 'timezone',
      localeCandidates,
      timezone,
      matchedLocaleRegion: null,
    };
  }

  for (const locale of localeCandidates) {
    const regionCode = extractRegionCode(locale);
    if (regionCode && getCountryByCode(regionCode)) {
      return {
        country: regionCode,
        source: 'locale-region',
        localeCandidates,
        timezone,
        matchedLocaleRegion: regionCode,
      };
    }
  }

  const primaryLanguage = localeCandidates[0]?.split(/[-_]/)[0]?.toLowerCase();
  const languageCountry = primaryLanguage
    ? LANGUAGE_TO_COUNTRY[primaryLanguage]
    : null;

  if (languageCountry) {
    return {
      country: languageCountry,
      source: 'language-map',
      localeCandidates,
      timezone,
      matchedLocaleRegion: null,
    };
  }

  return {
    country: ONBOARDING_FALLBACK_COUNTRY,
    source: 'fallback',
    localeCandidates,
    timezone,
    matchedLocaleRegion: null,
  };
}

export function getBrowserLanguage(): string {
  const localeCandidate = getBrowserLocaleCandidates()[0] ?? 'fr';
  return localeCandidate.split(/[-_]/)[0]?.toLowerCase() || 'fr';
}
