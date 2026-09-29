import { isSupportedLocale } from "@louez/types";
import type { EmailLocale } from "./types";

/** Respect the language chosen in the app before the browser preference. */
export const getEmailLocaleFromHeaders = (headers: Headers): EmailLocale => {
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("NEXT_LOCALE="))
    ?.slice("NEXT_LOCALE=".length);
  if (isSupportedLocale(cookie)) return cookie;

  const preferences = (headers.get("accept-language") ?? "")
    .split(",")
    .map((entry) => {
      const [tag, quality] = entry.trim().split(";");
      const weight = quality ? Number(quality.trim().replace(/^q=/, "")) : 1;
      return { locale: tag.toLowerCase().split("-")[0], weight };
    })
    .filter(({ weight }) => Number.isFinite(weight) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight);

  for (const { locale } of preferences) {
    if (isSupportedLocale(locale)) return locale;
  }
  return "fr";
};
