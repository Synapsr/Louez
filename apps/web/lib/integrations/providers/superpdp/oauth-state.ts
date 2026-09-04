import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { env } from "@/env";

const superPdpOAuthStateSchema = z.object({
  storeId: z.string().min(1),
  userId: z.string().min(1),
  returnTo: z.string().min(1),
  nonce: z.string().min(16),
  exp: z.number().int(),
});

type SuperPdpOAuthState = z.infer<typeof superPdpOAuthStateSchema>;

function getStateSecret(): string {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required for integration OAuth");
  }

  return env.INTEGRATION_ENCRYPTION_KEY;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export function createSuperPdpOAuthState(input: {
  storeId: string;
  userId: string;
  returnTo: string;
}): string {
  const state = {
    ...input,
    nonce: randomBytes(24).toString("base64url"),
    exp: Date.now() + 10 * 60 * 1000,
  } satisfies SuperPdpOAuthState;
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

export function parseSuperPdpOAuthState(state: string): SuperPdpOAuthState | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const actual = Buffer.from(signature);
  const expected = Buffer.from(signPayload(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const parsed = superPdpOAuthStateSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.exp >= Date.now() ? parsed : null;
  } catch {
    return null;
  }
}
