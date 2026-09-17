"use client";
import { useLocale } from "next-intl";
import { type Locale, defaultLocale, isLocale } from "@/i18n/config";

/** The language the demo page was asked for, as a known locale. */
export const useDemoLocale = (): Locale => {
  const locale = useLocale();
  return isLocale(locale) ? locale : defaultLocale;
};
