import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

interface PricingDemoText {
  summer: string;
}

const text: Record<Locale, PricingDemoText> = {
  fr: { summer: "Saison d’été" },
  en: { summer: "Summer season" },
  it: { summer: "Stagione estiva" },
  nl: { summer: "Zomerseizoen" },
  pt: { summer: "Temporada de verão" },
  de: { summer: "Sommersaison" },
  es: { summer: "Temporada de verano" },
  pl: { summer: "Sezon letni" },
};

export const getPricingDemoText = (locale?: string): PricingDemoText =>
  text[isLocale(locale) ? locale : defaultLocale];
