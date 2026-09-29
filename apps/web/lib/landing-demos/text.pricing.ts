import { supplementalMessages } from "@/lib/i18n/supplemental-messages";
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
  zh: {summer: supplementalMessages.zh.demo_pricing_summer,},
  ja: {summer: supplementalMessages.ja.demo_pricing_summer,},
  ru: {summer: supplementalMessages.ru.demo_pricing_summer,},
  id: {summer: supplementalMessages.id.demo_pricing_summer,},
  ko: {summer: supplementalMessages.ko.demo_pricing_summer,},
};

export const getPricingDemoText = (locale?: string): PricingDemoText =>
  text[isLocale(locale) ? locale : defaultLocale];
