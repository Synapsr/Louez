import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';
import { env as authEnv } from '@louez/auth/env';
import { env as dbEnv } from '@louez/db/env';
import { env as emailEnv } from '@louez/email/env';
import { env as validationsEnv } from '@louez/validations/env';

export const env = createEnv({
  extends: [dbEnv, validationsEnv, authEnv, emailEnv],

  server: {
    // ===== Authentication =====
    AUTH_TRUST_HOST: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),

    // ===== Storage / S3 (Required for image uploads) =====
    S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL'),
    S3_REGION: z.string().min(1, 'S3_REGION is required'),
    S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
    S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
    S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
    S3_PUBLIC_URL: z.url('S3_PUBLIC_URL must be a valid URL'),

    // ===== Stripe (Required for payments) =====
    STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .min(1, 'STRIPE_WEBHOOK_SECRET is required'),
    STRIPE_CONNECT_WEBHOOK_SECRET: z
      .string()
      .min(1, 'STRIPE_CONNECT_WEBHOOK_SECRET is required'),

    // Stripe Price IDs (EUR)
    STRIPE_PRICE_PRO_MONTHLY: z
      .string()
      .min(1, 'STRIPE_PRICE_PRO_MONTHLY is required'),
    STRIPE_PRICE_PRO_YEARLY: z
      .string()
      .min(1, 'STRIPE_PRICE_PRO_YEARLY is required'),
    STRIPE_PRICE_ULTRA_MONTHLY: z
      .string()
      .min(1, 'STRIPE_PRICE_ULTRA_MONTHLY is required'),
    STRIPE_PRICE_ULTRA_YEARLY: z
      .string()
      .min(1, 'STRIPE_PRICE_ULTRA_YEARLY is required'),

    // Stripe Price IDs (USD)
    STRIPE_PRICE_PRO_MONTHLY_USD: z
      .string()
      .min(1, 'STRIPE_PRICE_PRO_MONTHLY_USD is required'),
    STRIPE_PRICE_PRO_YEARLY_USD: z
      .string()
      .min(1, 'STRIPE_PRICE_PRO_YEARLY_USD is required'),
    STRIPE_PRICE_ULTRA_MONTHLY_USD: z
      .string()
      .min(1, 'STRIPE_PRICE_ULTRA_MONTHLY_USD is required'),
    STRIPE_PRICE_ULTRA_YEARLY_USD: z
      .string()
      .min(1, 'STRIPE_PRICE_ULTRA_YEARLY_USD is required'),

    // ===== SMS (Required for SMS notifications) =====
    SMS_PROVIDER: z
      .enum(['smspartner', 'twilio', 'vonage'])
      .default('smspartner'),
    SMS_DEFAULT_SENDER: z.string().default('Louez'),
    SMS_PARTNER_API_KEY: z.string().optional(),

    // ===== Google Places (Required for address search) =====
    GOOGLE_PLACES_API_KEY: z
      .string()
      .min(1, 'GOOGLE_PLACES_API_KEY is required'),
    GOOGLE_PLACES_CACHE_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(120),

    // ===== Platform Admin (Required) =====
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((val) =>
        val ? val.split(',').map((email) => email.trim()) : [],
      ),

    // ===== Discord Notifications (Required for platform notifications) =====
    DISCORD_ADMIN_WEBHOOK_URL: z
      .url('DISCORD_ADMIN_WEBHOOK_URL must be a valid URL')
      .optional(),

    // ===== Tulip Integrations (Optional) =====
    TULIP_API_BASE_URL: z
      .string()
      .url('TULIP_API_BASE_URL must be a valid URL')
      .default('https://api.mytulip.io/v2'),
    TULIP_ENCRYPTION_KEY: z.string().min(16).optional(),
    TULIP_CALENDLY_URL: z
      .string()
      .url('TULIP_CALENDLY_URL must be a valid URL')
      .optional(),

    // ===== Cron Jobs (Required) =====
    CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),

    // ===== Development =====
    AUTO_DB_SETUP: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    PREVIEW_STORE_SLUG: z.string().default(''),
  },

  client: {
    // ===== Application URLs (Required) =====
    NEXT_PUBLIC_APP_URL: z.url('NEXT_PUBLIC_APP_URL must be a valid URL'),
    NEXT_PUBLIC_APP_DOMAIN: z
      .string()
      .min(1, 'NEXT_PUBLIC_APP_DOMAIN is required'),
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN: z.string().default('app'),

    // ===== Stripe (Required for payments) =====
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
      .string()
      .min(1, 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required'),

    // ===== PostHog Analytics (Required) =====
    NEXT_PUBLIC_POSTHOG_KEY: z
      .string()
      .min(1, 'NEXT_PUBLIC_POSTHOG_KEY is required'),
    NEXT_PUBLIC_POSTHOG_HOST: z.url().default('https://eu.i.posthog.com'),

    // ===== Umami Analytics (Required) =====
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: z
      .url('NEXT_PUBLIC_UMAMI_SCRIPT_URL must be a valid URL')
      .optional(),
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),

    // ===== Gleap (Required for feedback) =====
    NEXT_PUBLIC_GLEAP_API_KEY: z.string().optional(),
  },

  runtimeEnv: {
    // Server
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
    STRIPE_PRICE_ULTRA_MONTHLY: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
    STRIPE_PRICE_ULTRA_YEARLY: process.env.STRIPE_PRICE_ULTRA_YEARLY,
    STRIPE_PRICE_PRO_MONTHLY_USD: process.env.STRIPE_PRICE_PRO_MONTHLY_USD,
    STRIPE_PRICE_PRO_YEARLY_USD: process.env.STRIPE_PRICE_PRO_YEARLY_USD,
    STRIPE_PRICE_ULTRA_MONTHLY_USD: process.env.STRIPE_PRICE_ULTRA_MONTHLY_USD,
    STRIPE_PRICE_ULTRA_YEARLY_USD: process.env.STRIPE_PRICE_ULTRA_YEARLY_USD,
    SMS_PROVIDER: process.env.SMS_PROVIDER,
    SMS_DEFAULT_SENDER: process.env.SMS_DEFAULT_SENDER,
    SMS_PARTNER_API_KEY: process.env.SMS_PARTNER_API_KEY,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    GOOGLE_PLACES_CACHE_TTL_HOURS: process.env.GOOGLE_PLACES_CACHE_TTL_HOURS,
    PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS,
    DISCORD_ADMIN_WEBHOOK_URL: process.env.DISCORD_ADMIN_WEBHOOK_URL,
    TULIP_API_BASE_URL: process.env.TULIP_API_BASE_URL,
    TULIP_ENCRYPTION_KEY: process.env.TULIP_ENCRYPTION_KEY,
    TULIP_CALENDLY_URL: process.env.TULIP_CALENDLY_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    AUTO_DB_SETUP: process.env.AUTO_DB_SETUP,
    PREVIEW_STORE_SLUG: process.env.PREVIEW_STORE_SLUG,

    // Client
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN:
      process.env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_GLEAP_API_KEY: process.env.NEXT_PUBLIC_GLEAP_API_KEY,
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
