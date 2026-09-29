import type { EmailLocale } from "@louez/email";

/** Auth e-mails follow the browser language of the request that triggered them. */
export function getLocaleFromHeaders(hdrs: Headers): EmailLocale {
  const acceptLanguage = hdrs.get("accept-language") || "";
  const candidate = acceptLanguage.toLowerCase().slice(0, 2);
  switch (candidate) {
    case "de":
    case "en":
    case "es":
    case "fr":
    case "it":
    case "nl":
    case "pl":
    case "pt":
      return candidate;
    default:
      return "fr";
  }
}
