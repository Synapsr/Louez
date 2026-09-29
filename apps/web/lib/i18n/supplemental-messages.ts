import { createTranslator } from "next-intl";
import zh from "@/messages/supplemental/zh.json";
import ja from "@/messages/supplemental/ja.json";
import ru from "@/messages/supplemental/ru.json";
import id from "@/messages/supplemental/id.json";
import ko from "@/messages/supplemental/ko.json";

// Small catalogs shared by notification templates and their dashboard previews.
export const supplementalMessages = { zh, ja, ru, id, ko };
type SupplementalLocale = keyof typeof supplementalMessages;
type SupplementalKey = keyof typeof zh;

export const formatSupplementalMessage = (
  locale: SupplementalLocale,
  key: SupplementalKey,
  values: Record<string, string>,
): string => createTranslator({ locale, messages: supplementalMessages[locale] })(key, values);
