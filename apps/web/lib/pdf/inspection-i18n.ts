import type { Locale } from "@/i18n/config";
import fr from "@/messages/inspections/fr.json";
import en from "@/messages/inspections/en.json";
import zh from "@/messages/inspections/zh.json";
import ja from "@/messages/inspections/ja.json";
import ru from "@/messages/inspections/ru.json";
import id from "@/messages/inspections/id.json";
import ko from "@/messages/inspections/ko.json";
import type { InspectionTranslations } from "./inspection-report";

const messages = {
  fr,
  en,
  it: en,
  nl: en,
  pt: en,
  de: en,
  es: en,
  pl: en,
  zh,
  ja,
  ru,
  id,
  ko,
} satisfies Record<Locale, InspectionTranslations>;

export const getInspectionTranslations = (locale: Locale): InspectionTranslations =>
  messages[locale];
