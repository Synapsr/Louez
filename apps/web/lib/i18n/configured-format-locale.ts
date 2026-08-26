import "server-only";

import { env } from "@/env";
import { resolveFormatLocale, type ResolvedFormatLocale } from "@/lib/i18n/format-locale";

export const getConfiguredFormatLocale = (locale?: string): ResolvedFormatLocale =>
  resolveFormatLocale(locale, env.NEXT_PUBLIC_FORMAT_LOCALE);
