import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
    SMTP_PASSWORD: z.string().min(1, 'SMTP_PASSWORD is required'),
    SMTP_FROM: z.string().min(1, 'SMTP_FROM is required'),
  },
  runtimeEnv: {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
