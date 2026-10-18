import { resolveLiveVoice } from "@louez/voice/catalog";
import { env } from "@/env";

export function isLiveConfigured(): boolean {
  try {
    const url = new URL(env.VOICE_RELAY_WS_URL ?? "");
    return (
      url.protocol === "wss:" &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (env.VOICE_RELAY_SIGNING_SECRET?.length ?? 0) >= 32
    );
  } catch {
    return false;
  }
}
export const getLiveModel = () => env.AI_PHONE_LIVE_MODEL?.trim() || "gpt-live-1";
export const getPhoneBackendModel = () => env.AI_PHONE_BACKEND_MODEL?.trim() || "gpt-5.6-luna";
export const getMaxCallSeconds = () => {
  const value = Number(env.AI_PHONE_MAX_CALL_SECONDS);
  return Number.isFinite(value) && value >= 30 ? Math.min(3600, Math.floor(value)) : 600;
};
export const getRelaySigningSecret = () => env.VOICE_RELAY_SIGNING_SECRET ?? "";
export const getRelayWsUrl = () => (env.VOICE_RELAY_WS_URL ?? "").replace(/\/+$/, "");
export const resolveVoiceId = (language: string, storeVoice?: string | null) =>
  resolveLiveVoice(language, storeVoice, env.AI_PHONE_DEFAULT_VOICE);
