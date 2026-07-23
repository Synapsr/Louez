import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    // Absolute URL of the public bucket, or an absolute path ("/files") when
    // assets are served same-origin by the app (standalone deployments).
    S3_PUBLIC_URL: z
      .string()
      .refine((value) => value.startsWith('/') || URL.canParse(value), {
        message: 'S3_PUBLIC_URL must be an absolute URL or an absolute path',
      }),
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
