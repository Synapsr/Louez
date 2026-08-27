import { z } from "zod";

const isRegionalLocale = (value: string): boolean => {
  try {
    const canonicalLocale = Intl.getCanonicalLocales(value)[0];
    return Boolean(canonicalLocale && new Intl.Locale(canonicalLocale).region);
  } catch {
    return false;
  }
};

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url("NEXT_PUBLIC_APP_URL must be a valid URL"),
  NEXT_PUBLIC_APP_DOMAIN: z.string().min(1, "NEXT_PUBLIC_APP_DOMAIN is required"),
  NEXT_PUBLIC_DASHBOARD_SUBDOMAIN: z.string().default("app"),
  NEXT_PUBLIC_FORMAT_LOCALE: z
    .string()
    .trim()
    .refine(isRegionalLocale, "NEXT_PUBLIC_FORMAT_LOCALE must include a valid language and region")
    .optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
  NEXT_PUBLIC_APP_VERSION: z.string().min(1).max(100).optional(),
  NEXT_PUBLIC_UMAMI_SCRIPT_URL: z
    .url("NEXT_PUBLIC_UMAMI_SCRIPT_URL must be a valid URL")
    .optional(),
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
  NEXT_PUBLIC_GLEAP_API_KEY: z.string().optional(),
  NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY: z.string().optional(),
  NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY: z.string().optional(),
  NEXT_PUBLIC_OPENREPLAY_INGEST_POINT: z
    .url("NEXT_PUBLIC_OPENREPLAY_INGEST_POINT must be a valid URL")
    .optional(),
  NEXT_PUBLIC_FROMHELLO_API_URL: z.url().optional(),
  NEXT_PUBLIC_FROMHELLO_KEY: z.string().optional(),
  NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const PUBLIC_ENV_KEYS = publicEnvSchema.keyof().options;

type PublicEnvSource = Record<string, string | undefined>;
type PublicEnvReader = (name: string) => string | undefined;

interface ReadPublicEnvOptions {
  appVersion?: string;
  readEnv: PublicEnvReader;
}

export const getPublicEnvRuntimeValues = (
  source: PublicEnvSource,
): Record<keyof PublicEnv, string | undefined> => {
  const appUrl = source.NEXT_PUBLIC_APP_URL || source.AUTH_URL;
  let appDomain = source.NEXT_PUBLIC_APP_DOMAIN;

  if (!appDomain && appUrl) {
    try {
      appDomain = new URL(appUrl).host;
    } catch {
      appDomain = undefined;
    }
  }

  return {
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_APP_DOMAIN: appDomain,
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN: source.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN,
    NEXT_PUBLIC_FORMAT_LOCALE: source.NEXT_PUBLIC_FORMAT_LOCALE,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: source.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: source.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: source.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_APP_VERSION: source.NEXT_PUBLIC_APP_VERSION,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: source.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: source.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_GLEAP_API_KEY: source.NEXT_PUBLIC_GLEAP_API_KEY,
    NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY: source.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY,
    NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY:
      source.NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY,
    NEXT_PUBLIC_OPENREPLAY_INGEST_POINT: source.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT,
    NEXT_PUBLIC_FROMHELLO_API_URL: source.NEXT_PUBLIC_FROMHELLO_API_URL,
    NEXT_PUBLIC_FROMHELLO_KEY: source.NEXT_PUBLIC_FROMHELLO_KEY,
    NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN: source.NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN,
  } satisfies Record<keyof PublicEnv, string | undefined>;
};

export const parsePublicEnv = (source: PublicEnvSource): PublicEnv =>
  publicEnvSchema.parse(getPublicEnvRuntimeValues(source));

export const readPublicEnvRuntimeValues = ({
  appVersion,
  readEnv,
}: ReadPublicEnvOptions): Record<keyof PublicEnv, string | undefined> =>
  getPublicEnvRuntimeValues({
    AUTH_URL: readEnv("AUTH_URL"),
    ...Object.fromEntries(
      PUBLIC_ENV_KEYS.map((key) => [
        key,
        key === "NEXT_PUBLIC_APP_VERSION" ? appVersion : readEnv(key),
      ]),
    ),
  });

export const readPublicEnvRuntime = (options: ReadPublicEnvOptions): PublicEnv =>
  publicEnvSchema.parse(readPublicEnvRuntimeValues(options));

export const selectPublicEnv = (source: PublicEnv): PublicEnv => publicEnvSchema.parse(source);
