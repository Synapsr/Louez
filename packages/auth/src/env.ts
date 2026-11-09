import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const trustedProxySchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['cloudflare']).optional(),
)

export type TrustedProxy = NonNullable<z.infer<typeof trustedProxySchema>>

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
    AUTH_URL: z.url('AUTH_URL must be a valid URL'),
    // Google OAuth is optional: without credentials the provider is not
    // registered and the login UI hides the Google button.
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    // The ingress in front of the app that says who the visitor is. Only
    // `cloudflare`: its `cf-connecting-ip` then lets the AI platforms' servers
    // get their OAuth rate-limit ceiling (rate-limit.ts). Unset (or empty), no
    // header raises a ceiling. Set it only when the origin accepts traffic from
    // Cloudflare alone.
    TRUSTED_PROXY: trustedProxySchema,
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    TRUSTED_PROXY: process.env.TRUSTED_PROXY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
