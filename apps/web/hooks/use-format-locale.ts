"use client";

import { useLocale } from "next-intl";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";

export const useFormatLocale = () => {
  const locale = useLocale();
  const { NEXT_PUBLIC_FORMAT_LOCALE: regionalOverride } = usePublicEnv();

  return resolveFormatLocale(locale, regionalOverride);
};
