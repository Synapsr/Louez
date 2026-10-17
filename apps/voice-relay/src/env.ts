import { z } from "zod";

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}, "An HTTPS URL without credentials, query or fragment is required");

export const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_URL: httpsUrl,
  VOICE_RELAY_WS_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "wss:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, "Use the public wss:// origin without a path"),
  VOICE_RELAY_SIGNING_SECRET: z.string().min(32),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  OPENAI_API_KEY: z.string().min(1),
  AI_PHONE_LIVE_MODEL: z.string().min(1).default("gpt-live-1"),
  MAX_CONCURRENT_CALLS: z.coerce.number().int().min(1).max(1000).default(50),
  VOICE_IDLE_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  // RMS threshold in decoded 16-bit PCM; tune against real telephone noise.
  VOICE_VAD_THRESHOLD: z.coerce.number().min(100).max(10000).default(900),
});
export type Config = z.infer<typeof configSchema>;
export const loadConfig = () => configSchema.parse(process.env);
