import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    S3_PUBLIC_URL: z.url('S3_PUBLIC_URL must be a valid URL'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
  },
  runtimeEnv: {
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
