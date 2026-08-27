import "server-only";

import { getLocale } from "next-intl/server";

import { getConfiguredFormatLocale } from "@/lib/i18n/configured-format-locale";

export const getRequestFormatLocale = async () => getConfiguredFormatLocale(await getLocale());
