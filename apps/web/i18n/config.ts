export const locales = ["fr", "en", "it", "nl", "pt", "de", "es", "pl"] as const;
export const defaultLocale = "fr" as const;

export type Locale = (typeof locales)[number];

export const isLocale = (value: string | null | undefined): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

export const localeNames: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  it: "Italiano",
  nl: "Nederlands",
  pt: "Português",
  de: "Deutsch",
  es: "Español",
  pl: "Polski",
};

export const localeFlags: Record<Locale, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  it: "🇮🇹",
  nl: "🇳🇱",
  pt: "🇵🇹",
  de: "🇩🇪",
  es: "🇪🇸",
  pl: "🇵🇱",
};

export const localeCountries: Record<Locale, string> = {
  fr: "FR",
  en: "GB",
  it: "IT",
  nl: "NL",
  pt: "PT",
  de: "DE",
  es: "ES",
  pl: "PL",
};
