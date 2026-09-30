/** Languages shared by the app, booking validation and transactional emails. */
export const supportedLocales = [
  "fr",
  "en",
  "it",
  "nl",
  "pt",
  "de",
  "es",
  "pl",
  "zh",
  "ja",
  "ru",
  "id",
  "ko",
] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export const isSupportedLocale = (value: string | null | undefined): value is SupportedLocale =>
  typeof value === "string" && supportedLocales.some((locale) => locale === value);
