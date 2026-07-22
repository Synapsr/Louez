import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { env as authEnv } from '@louez/auth/env';
import { env as dbEnv } from '@louez/db/env';
import { env as emailEnv } from '@louez/email/env';
import { env as validationsEnv } from '@louez/validations/env';

import { payAsYouGoConfigSchema } from '@/lib/pay-as-you-go/config';

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

    // ===== Web Push (Optional — VAPID keys for push notifications) =====
    // One app-wide keypair. Generate with `npx web-push generate-vapid-keys`.
    // When unset, push is simply unavailable (the channel degrades gracefully).
    VAPID_PRIVATE_KEY: z.string().optional(),
    // Contact subject for the push service (mailto: or https:). Falls back to
    // NEXT_PUBLIC_APP_URL in the sender when unset.
    VAPID_SUBJECT: z.string().optional(),

    // ===== Tulip Integrations (Optional) =====
    TULIP_API_KEY: z.string().optional(),
    TULIP_API_BASE_URL: z
      .url('TULIP_API_BASE_URL must be a valid URL')
      .default('https://api.mytulip.io/v2'),
    TULIP_CALENDLY_URL: z
      .string()
      .url('TULIP_CALENDLY_URL must be a valid URL')
      .optional(),

    // ===== Integrations (Optional until a provider is configured) =====
    INTEGRATION_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{43}=$|^[A-Za-z0-9_-]{43}$/,
        'INTEGRATION_ENCRYPTION_KEY must be a base64url-encoded 32-byte key',
      )
      .optional(),
    GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
    GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),

    // ===== Cron Jobs (Required) =====
    CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),

    // ===== AI Chat Assistant (Optional) =====
    AI_PROVIDER: z.enum(['anthropic', 'openai', 'google']).optional(),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    // Storefront AI advisor: optional cheaper model for public traffic
    // (falls back to AI_MODEL, then the provider default) and a per-store
    // daily message cap protecting token spend.
    AI_ADVISOR_MODEL: z.string().optional(),
    AI_ADVISOR_DAILY_STORE_LIMIT: z.coerce.number().int().min(1).optional(),

    // ===== AI Advisor credits (Optional — cloud commercial layer) =====
    // The whole credit / metering / top-up layer is INERT unless
    // AI_CREDITS_ENABLED === 'true'. Self-host default (unset) → the advisor
    // runs on rate-limits only: no credits, no metering, no billing UI. No
    // commercial value ships in code — token prices, credit value and pack
    // prices ALL live here, so the repo never reveals cost or margin.
    AI_CREDITS_ENABLED: z.string().optional(),
    // Real advisor-model token cost, USD per 1M tokens (metering input only,
    // never surfaced to anyone).
    AI_ADVISOR_INPUT_USD_PER_MTOK: z.coerce.number().min(0).optional(),
    AI_ADVISOR_OUTPUT_USD_PER_MTOK: z.coerce.number().min(0).optional(),
    AI_ADVISOR_CACHED_INPUT_USD_PER_MTOK: z.coerce.number().min(0).optional(),
    // USD cost that equals "1 credit" when metering a conversation. Set it to
    // the typical conversation cost so 1 credit ≈ 1 conversation.
    AI_CREDIT_COST_BASIS_USD: z.coerce.number().positive().optional(),
    // Prepaid credits gifted to a NEW store at account creation.
    FREE_AI_CREDITS: z.coerce.number().int().min(0).max(1_000_000).default(0),
    // Monthly INCLUDED credits per plan slug, JSON e.g. {"pro":200,"ultra":1000}.
    // Injected into the resolved plan at runtime — never hardcoded in plans.ts.
    AI_CREDIT_MONTHLY_INCLUDED: z.string().optional(),
    // Sold credit packs, JSON e.g. [{"credits":100,"priceCents":1200}, ...].
    AI_CREDIT_PACKAGES: z.string().optional(),

    // ===== AI Phone receptionist (Optional — inbound voice channel) =====
    // The whole phone feature is INERT unless AI_PHONE_ENABLED === 'true' AND a
    // voice provider is configured. When off (default), no phone UI is shown and
    // the webhooks return 404. It reuses the AI agent + AI-credit layer, so it
    // additionally requires AI_PROVIDER/AI_API_KEY (and, for billing,
    // AI_CREDITS_ENABLED). No commercial value ships in code — the audio cost
    // basis lives here, like the advisor token prices.
    AI_PHONE_ENABLED: z.string().optional(),
    // Telephony provider serving inbound calls. Only 'twilio' is implemented.
    VOICE_PROVIDER: z.enum(['twilio']).optional(),
    // Twilio credentials (used to validate inbound webhook signatures and, later,
    // to provision numbers). Shared with a future Twilio SMS provider.
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    // Regulatory data required to PROVISION numbers in many countries (e.g. FR):
    // a Twilio Address SID (AD...) and, for stricter countries, a Regulatory
    // Bundle SID (BU...). Created once in the operator's Twilio account and sent
    // with the purchase. Optional — only needed for auto-provisioning.
    TWILIO_ADDRESS_SID: z.string().optional(),
    TWILIO_BUNDLE_SID: z.string().optional(),
    // Optional cheaper/faster model for the phone agent (falls back to
    // AI_ADVISOR_MODEL, then AI_MODEL, then the provider default).
    AI_PHONE_MODEL: z.string().optional(),
    // Blended real audio cost of the chosen voice stack, USD per MINUTE
    // (telephony inbound + STT + TTS). Metered per call alongside LLM tokens and
    // converted to credits via AI_CREDIT_COST_BASIS_USD. 0/unset ⇒ audio metering
    // off (tokens only). Never surfaced to anyone.
    AI_VOICE_AUDIO_USD_PER_MIN: z.coerce.number().min(0).optional(),
    // Safety cap: a single call never debits more than this many credits.
    AI_PHONE_MAX_CREDITS_PER_CALL: z.coerce.number().int().min(1).default(20),
    // Hard cap on call duration (seconds) to bound cost / toll-fraud blast radius.
    AI_PHONE_MAX_CALL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(600),
    // ----- Streaming transport (Twilio ConversationRelay) -----
    // Phone transport. 'gather' (default) = turn-based Twilio <Gather>, robust and
    // serverless-friendly. 'relay' = Twilio ConversationRelay (streaming STT/TTS +
    // barge-in) through a self-hosted WebSocket worker — needs VOICE_RELAY_WS_URL
    // and VOICE_RELAY_SIGNING_SECRET, else it stays on <Gather>.
    AI_PHONE_TRANSPORT: z.enum(['gather', 'relay']).optional(),
    // Public wss:// URL of the ConversationRelay worker (e.g. wss://voice-relay.example.com).
    VOICE_RELAY_WS_URL: z.string().optional(),
    // HMAC secret shared with the worker: authenticates the relay handshake and
    // the worker↔app per-turn requests, both directions. Required for 'relay'.
    VOICE_RELAY_SIGNING_SECRET: z.string().optional(),
    // ConversationRelay TTS/STT providers (never hardcoded). Defaults tuned for
    // realism + latency. https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
    AI_PHONE_TTS_PROVIDER: z.string().optional(),
    AI_PHONE_STT_PROVIDER: z.string().optional(),
    // Provider voice id per app locale (JSON), e.g. {"fr":"<id>","en":"<id>"}. A
    // per-store voice (settings.voice) overrides it. All 8 locales supported.
    AI_PHONE_VOICES: z.string().optional(),
    // Fallback voice id when a locale is absent from AI_PHONE_VOICES and the store set none.
    AI_PHONE_DEFAULT_VOICE: z.string().optional(),
    // Catalog of voices a STORE can pick from, per app locale (JSON):
    // {"fr":[{"id":"<id>","label":"Léa","gender":"female"}, ...], ...}. Powers the
    // in-dashboard voice picker; the chosen id is saved as the store voice. Voice
    // ids stay in env, never in the repo.
    AI_PHONE_VOICE_CATALOG: z.string().optional(),
    // ElevenLabs API key (optional). When set, the dashboard voice picker is
    // populated automatically from the account's voices (name + gender) and the
    // store can PREVIEW a voice speaking a sample in the chosen language.
    ELEVENLABS_API_KEY: z.string().optional(),
    // Voice ids to surface first with a "recommended" badge in the picker,
    // comma-separated. Operator-curated, kept in env (never in the repo).
    AI_PHONE_RECOMMENDED_VOICES: z.string().optional(),

    // ===== fromHello (Optional — engagement & growth) =====
    FROMHELLO_API_URL: z.url().optional(),
    FROMHELLO_API_KEY: z.string().optional(),

    // ===== Pay-as-you-go default pricing (Optional) =====
    // JSON describing the per-rental pricing snapshotted onto every NEW store at
    // account creation (an "ephemeral offer"). Omitted/empty → the hardcoded platform
    // default ladder. Changing this only affects accounts created AFTER the deploy;
    // existing stores keep the pricing snapshotted at their creation. Validated at
    // boot so a malformed offer fails the deploy instead of silently mispricing.
    // Examples:
    //   {"flatRateCents":25}                                  → 0.25€ per rental, flat
    //   {"tiers":[{"upToCount":50,"priceCents":25},{"upToCount":null,"priceCents":100}]}
    // Number of free reservations gifted to a NEW store at account creation (the
    // welcome allowance). While credits remain, a rental's pay-as-you-go commission is
    // waived. Snapshotted per store at creation and editable per store in admin, so
    // changing this only affects accounts created afterwards. Default 15.
    PAYG_FREE_RESERVATIONS: z.coerce.number().int().min(0).max(100_000).default(15),

    PAYG_DEFAULT_PRICING: z
      .string()
      .optional()
      .transform((val, ctx) => {
        if (!val || val.trim() === '') return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(val);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'PAYG_DEFAULT_PRICING must be valid JSON',
          });
          return z.NEVER;
        }
        const result = payAsYouGoConfigSchema.safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `PAYG_DEFAULT_PRICING is invalid: ${result.error.issues
              .map((i) => i.message)
              .join('; ')}`,
          });
          return z.NEVER;
        }
        return result.data;
      }),

    // ===== Referral program =====
    // Free reservations granted to the Referrer when a referral qualifies (PAYG referrer;
    // a subscribed referrer gets the equivalent euro invoice credit). Default 30.
    REFERRAL_REFERRER_REWARD: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(30),
    // Free reservations gifted to a Referred Store at sign-up (instead of the welcome 15).
    REFERRAL_REFERRED_REWARD: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(30),
    // Minimum online payment (in cents) a Referred Store must take to unlock the reward.
    REFERRAL_MIN_QUALIFYING_CENTS: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .default(2000),
    // Max rewards a single Referrer can earn per calendar month. 0 = unlimited (launch default).
    REFERRAL_MONTHLY_CAP: z.coerce.number().int().min(0).max(100_000).default(0),
    // Days after a grant during which a refunded/disputed qualifying payment claws it back.
    REFERRAL_CLAWBACK_DAYS: z.coerce.number().int().min(0).max(3650).default(30),

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

    // ===== Web Push (Optional — VAPID public key for subscribe()) =====
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),

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

    // ===== OpenReplay (Optional — session replay) =====
    NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY: z
      .string()
      .default('W9AU13WEWMDZ4m8KQzWZ'),
    NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY: z.string().optional(),
    NEXT_PUBLIC_OPENREPLAY_INGEST_POINT: z
      .url('NEXT_PUBLIC_OPENREPLAY_INGEST_POINT must be a valid URL')
      .default('https://replay.lumy.cloud/ingest'),

    // ===== fromHello (Optional — engagement & growth) =====
    NEXT_PUBLIC_FROMHELLO_API_URL: z.url().optional(),
    NEXT_PUBLIC_FROMHELLO_KEY: z.string().optional(),
    // Set to e.g. ".louez.io" when marketing and app live on
    // different subdomains so the fh_aid cookie follows visitors
    // across the signup boundary. Leave unset for single-domain
    // deploys.
    NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN: z.string().optional(),
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
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    TULIP_API_BASE_URL: process.env.TULIP_API_BASE_URL,
    TULIP_API_KEY: process.env.TULIP_API_KEY,
    TULIP_CALENDLY_URL: process.env.TULIP_CALENDLY_URL,
    INTEGRATION_ENCRYPTION_KEY: process.env.INTEGRATION_ENCRYPTION_KEY,
    GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_ADVISOR_MODEL: process.env.AI_ADVISOR_MODEL,
    AI_ADVISOR_DAILY_STORE_LIMIT: process.env.AI_ADVISOR_DAILY_STORE_LIMIT,
    AI_CREDITS_ENABLED: process.env.AI_CREDITS_ENABLED,
    AI_ADVISOR_INPUT_USD_PER_MTOK: process.env.AI_ADVISOR_INPUT_USD_PER_MTOK,
    AI_ADVISOR_OUTPUT_USD_PER_MTOK: process.env.AI_ADVISOR_OUTPUT_USD_PER_MTOK,
    AI_ADVISOR_CACHED_INPUT_USD_PER_MTOK:
      process.env.AI_ADVISOR_CACHED_INPUT_USD_PER_MTOK,
    AI_CREDIT_COST_BASIS_USD: process.env.AI_CREDIT_COST_BASIS_USD,
    FREE_AI_CREDITS: process.env.FREE_AI_CREDITS,
    AI_CREDIT_MONTHLY_INCLUDED: process.env.AI_CREDIT_MONTHLY_INCLUDED,
    AI_CREDIT_PACKAGES: process.env.AI_CREDIT_PACKAGES,
    AI_PHONE_ENABLED: process.env.AI_PHONE_ENABLED,
    VOICE_PROVIDER: process.env.VOICE_PROVIDER,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_ADDRESS_SID: process.env.TWILIO_ADDRESS_SID,
    TWILIO_BUNDLE_SID: process.env.TWILIO_BUNDLE_SID,
    AI_PHONE_MODEL: process.env.AI_PHONE_MODEL,
    AI_VOICE_AUDIO_USD_PER_MIN: process.env.AI_VOICE_AUDIO_USD_PER_MIN,
    AI_PHONE_MAX_CREDITS_PER_CALL: process.env.AI_PHONE_MAX_CREDITS_PER_CALL,
    AI_PHONE_MAX_CALL_SECONDS: process.env.AI_PHONE_MAX_CALL_SECONDS,
    AI_PHONE_TRANSPORT: process.env.AI_PHONE_TRANSPORT,
    VOICE_RELAY_WS_URL: process.env.VOICE_RELAY_WS_URL,
    VOICE_RELAY_SIGNING_SECRET: process.env.VOICE_RELAY_SIGNING_SECRET,
    AI_PHONE_TTS_PROVIDER: process.env.AI_PHONE_TTS_PROVIDER,
    AI_PHONE_STT_PROVIDER: process.env.AI_PHONE_STT_PROVIDER,
    AI_PHONE_VOICES: process.env.AI_PHONE_VOICES,
    AI_PHONE_DEFAULT_VOICE: process.env.AI_PHONE_DEFAULT_VOICE,
    AI_PHONE_VOICE_CATALOG: process.env.AI_PHONE_VOICE_CATALOG,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    AI_PHONE_RECOMMENDED_VOICES: process.env.AI_PHONE_RECOMMENDED_VOICES,
    FROMHELLO_API_URL: process.env.FROMHELLO_API_URL,
    FROMHELLO_API_KEY: process.env.FROMHELLO_API_KEY,
    AUTO_DB_SETUP: process.env.AUTO_DB_SETUP,
    PREVIEW_STORE_SLUG: process.env.PREVIEW_STORE_SLUG,
    PAYG_DEFAULT_PRICING: process.env.PAYG_DEFAULT_PRICING,
    PAYG_FREE_RESERVATIONS: process.env.PAYG_FREE_RESERVATIONS,
    REFERRAL_REFERRER_REWARD: process.env.REFERRAL_REFERRER_REWARD,
    REFERRAL_REFERRED_REWARD: process.env.REFERRAL_REFERRED_REWARD,
    REFERRAL_MIN_QUALIFYING_CENTS: process.env.REFERRAL_MIN_QUALIFYING_CENTS,
    REFERRAL_MONTHLY_CAP: process.env.REFERRAL_MONTHLY_CAP,
    REFERRAL_CLAWBACK_DAYS: process.env.REFERRAL_CLAWBACK_DAYS,

    // Client
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN:
      process.env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_GLEAP_API_KEY: process.env.NEXT_PUBLIC_GLEAP_API_KEY,
    NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY:
      process.env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY,
    NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY:
      process.env.NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY,
    NEXT_PUBLIC_OPENREPLAY_INGEST_POINT:
      process.env.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT,
    NEXT_PUBLIC_FROMHELLO_API_URL: process.env.NEXT_PUBLIC_FROMHELLO_API_URL,
    NEXT_PUBLIC_FROMHELLO_KEY: process.env.NEXT_PUBLIC_FROMHELLO_KEY,
    NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN:
      process.env.NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN,
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
