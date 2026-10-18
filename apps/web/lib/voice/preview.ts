import { signRequest } from "@louez/voice/auth";
import { previewSchema } from "@louez/voice/protocol";
import { getRelaySigningSecret, getRelayWsUrl } from "./config";

const attempts = new Map<string, { count: number; until: number }>();
// Per-process abuse guard; the relay also caps concurrent paid generations and
// caches a finite catalog. No arbitrary text can reach this endpoint.
export function allowVoicePreview(storeId: string, now = Date.now()): boolean {
  const current = attempts.get(storeId);
  if (current && current.until > now) {
    if (current.count >= 12) return false;
    current.count++;
    return true;
  }
  if (attempts.size >= 1000) {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size >= 1000) return false;
  }
  attempts.set(storeId, { count: 1, until: now + 60_000 });
  return true;
}

export async function fetchVoicePreview(input: unknown): Promise<Response> {
  const values = previewSchema.parse(input);
  const url = new URL("/preview", getRelayWsUrl());
  url.protocol = "https:";
  const body = JSON.stringify(values);
  const timestamp = String(Date.now());
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    body,
    headers: {
      "content-type": "application/json",
      "x-relay-timestamp": timestamp,
      "x-relay-signature": signRequest(getRelaySigningSecret(), "/preview", timestamp, body),
    },
    signal: AbortSignal.timeout(23_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/wav")) {
    return new Response("Preview unavailable", { status: 503 });
  }
  return new Response(response.body, {
    headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" },
  });
}
