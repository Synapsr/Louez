import { supportedLocales, isSupportedLocale } from "@louez/types";

export const locales = supportedLocales;
export const defaultLocale = "fr" as const;

export type Locale = (typeof locales)[number];

export const isLocale = isSupportedLocale;

export const localeNames: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  it: "Italiano",
  nl: "Nederlands",
  pt: "Português",
  de: "Deutsch",
  es: "Español",
  pl: "Polski",
  zh: "简体中文",
  ja: "日本語",
  ru: "Русский",
  id: "Bahasa Indonesia",
  ko: "한국어",
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
  zh: "🇨🇳",
  ja: "🇯🇵",
  ru: "🇷🇺",
  id: "🇮🇩",
  ko: "🇰🇷",
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
  zh: "CN",
  ja: "JP",
  ru: "RU",
  id: "ID",
  ko: "KR",
};
