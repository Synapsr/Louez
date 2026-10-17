// Public GPT-Live presets, not account-specific voice IDs. Keep this entry point
// browser-safe. Source: OpenAI's Live conversation guide (2026-10-17).
export const LIVE_VOICES = [
  { id: "brise", label: "Brise", gender: "female", locale: "fr" },
  { id: "sillage", label: "Sillage", gender: "male", locale: "fr" },
  { id: "gleam", label: "Gleam", gender: "female", locale: "en" },
  { id: "meridian", label: "Meridian", gender: "male", locale: "en" },
  { id: "quartz", label: "Quartz", gender: "female", locale: "en-AU" },
  { id: "ripple", label: "Ripple", gender: "male", locale: "en-AU" },
  { id: "vesper", label: "Vesper", gender: "male", locale: "en-GB" },
  { id: "willow", label: "Willow", gender: "female", locale: "en-IE" },
  { id: "stone", label: "Stone", gender: "male", locale: "en-IE" },
  { id: "beacon", label: "Beacon", gender: "male", locale: "en-PH" },
  { id: "delta", label: "Delta", gender: "female", locale: "en-US" },
  { id: "cinder", label: "Cinder", gender: "male", locale: "en-US" },
  { id: "nuri", label: "Nuri", gender: "female", locale: "de" },
  { id: "juni", label: "Juni", gender: "female", locale: "de" },
  { id: "flitz", label: "Flitz", gender: "male", locale: "de" },
  { id: "bossa", label: "Bossa", gender: "female", locale: "pt" },
  { id: "tempo", label: "Tempo", gender: "male", locale: "pt" },
  { id: "nira", label: "Nira", gender: "female", locale: "hi" },
  { id: "harema", label: "Harema", gender: "female", locale: "ja" },
  { id: "shida", label: "Shida", gender: "male", locale: "ja" },
  { id: "noeul", label: "Noeul", gender: "female", locale: "ko" },
  { id: "alloy", label: "Alloy", gender: null, locale: "multilingual" },
  { id: "ash", label: "Ash", gender: null, locale: "multilingual" },
  { id: "ballad", label: "Ballad", gender: null, locale: "multilingual" },
  { id: "cedar", label: "Cedar", gender: null, locale: "multilingual" },
  { id: "coral", label: "Coral", gender: null, locale: "multilingual" },
  { id: "echo", label: "Echo", gender: null, locale: "multilingual" },
  { id: "marin", label: "Marin", gender: null, locale: "multilingual" },
  { id: "sage", label: "Sage", gender: null, locale: "multilingual" },
  { id: "shimmer", label: "Shimmer", gender: null, locale: "multilingual" },
  { id: "verse", label: "Verse", gender: null, locale: "multilingual" },
] as const;

export type LiveVoiceId = (typeof LIVE_VOICES)[number]["id"];
export type LiveVoice = (typeof LIVE_VOICES)[number];
export const isLiveVoice = (value: unknown): value is LiveVoiceId =>
  typeof value === "string" && LIVE_VOICES.some((voice) => voice.id === value);

// All presets are multilingual. Regional voices are preferences, not language
// restrictions. Unknown/legacy ElevenLabs IDs deliberately resolve to a preset.
export function defaultLiveVoice(language: string): LiveVoiceId {
  if (language === "fr") return "brise";
  if (language === "de") return "nuri";
  if (language === "pt") return "bossa";
  return "gleam";
}

export function resolveLiveVoice(
  language: string,
  selected?: string | null,
  fallback?: string,
): LiveVoiceId {
  return isLiveVoice(selected)
    ? selected
    : isLiveVoice(fallback)
      ? fallback
      : defaultLiveVoice(language);
}
