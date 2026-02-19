import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
    AUTH_URL: z.url('AUTH_URL must be a valid URL'),
    AUTH_GOOGLE_ID: z.string().min(1, 'AUTH_GOOGLE_ID is required'),
    AUTH_GOOGLE_SECRET: z.string().min(1, 'AUTH_GOOGLE_SECRET is required'),
  },
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
