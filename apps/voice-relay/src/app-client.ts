import { signRequest } from "@louez/voice/auth";
import { APP_PATH, type LiveRequest } from "@louez/voice/protocol";
import type { Config } from "./env.js";

export function createAppClient(config: Pick<Config, "APP_URL" | "VOICE_RELAY_SIGNING_SECRET">) {
  return async (body: LiveRequest): Promise<unknown> => {
    const raw = JSON.stringify(body);
    // Retries are safe: start claims one stream, writes claim a durable operation,
    // sync uses stable transcript/response IDs, close locks the session row.
    for (let attempt = 0; attempt < 3; attempt++) {
      const timestamp = String(Date.now());
      try {
        const response = await fetch(new URL(APP_PATH, config.APP_URL), {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-relay-timestamp": timestamp,
            "x-relay-signature": signRequest(
              config.VOICE_RELAY_SIGNING_SECRET,
              APP_PATH,
              timestamp,
              raw,
            ),
          },
          body: raw,
          signal: AbortSignal.timeout(25_000),
        });
        if (response.ok) return await response.json();
        if (response.status < 500) throw new AppRequestError(response.status);
      } catch (error) {
        if (error instanceof AppRequestError || attempt === 2) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    throw new Error("App unavailable");
  };
}
class AppRequestError extends Error {
  constructor(readonly status: number) {
    super(`Voice app rejected request (${status})`);
  }
}
export type AppClient = ReturnType<typeof createAppClient>;
