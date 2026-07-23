import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    // SMTP is optional: without it, outgoing email is disabled and sendEmail
    // logs-and-skips instead of sending (see isEmailConfigured in send.ts).
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    // Dev only: recipients allowed to receive email in development (the delivery
    // guard blocks everyone else). Comma-separated full emails (you@example.com)
    // and/or domain suffixes (@example.com).
    DEV_EMAIL_ALLOWLIST: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    DEV_EMAIL_ALLOWLIST: process.env.DEV_EMAIL_ALLOWLIST,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
