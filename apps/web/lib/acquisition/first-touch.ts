/**
 * First-touch attribution of a sign-up: what the louez.io site saw of the visit that
 * brought the person (docs/analytics/lifecycle.md). The site keeps it in the
 * `louez_attribution` cookie (Domain=.louez.io, httpOnly, 90 days), a base64url JSON
 * object of optional keys. The app reads it once, when the account is created
 * (lib/auth.ts), whichever way the person signed up: the cookie rides on the
 * sign-up's own request, the e-mail code's or the Google callback's.
 *
 * The cookie comes from a browser, so nothing in it is trusted: unknown keys are
 * dropped, every value is checked and capped, a value that looks like an e-mail
 * address is dropped, and a cookie that does not decode reads as no cookie.
 */

import { z } from "zod";

export const FIRST_TOUCH_COOKIE = "louez_attribution";

/** The cookie's string keys, as the site writes them. */
const STRING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "fbclid",
  "landing_path",
  "referrer_domain",
] as const;

type StringKey = (typeof STRING_KEYS)[number];

export type FirstTouch = Partial<Record<StringKey, string>> & {
  /** When the site saw the touch, in milliseconds since the epoch. */
  ts?: number;
};

export const ACQUISITION_CHANNELS = [
  "google_ads",
  "meta_ads",
  "ai_assistant",
  "organic",
  "referral",
  "direct",
] as const;

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

/** Longest value kept: utm values and click ids are far shorter. */
const MAX_VALUE_LENGTH = 255;
/** The cookie's longest accepted value, before decoding. */
const MAX_COOKIE_LENGTH = 4096;

const PRINTABLE = /^[\x20-\x7E -￿]+$/;
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

function cleanValue(key: StringKey, raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let value = raw.trim();
  if (key === "landing_path") {
    // The path only: a query or a fragment may hold anything, a person's address included.
    value = value.split(/[?#]/)[0] ?? "";
    if (!value.startsWith("/")) return undefined;
  }
  if (key === "referrer_domain") {
    value = value.toLowerCase().replace(/^www\./, "");
    if (!DOMAIN.test(value)) return undefined;
  }
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return undefined;
  if (!PRINTABLE.test(value) || value.includes("@")) return undefined;
  return value;
}

/** The decoded cookie: an object, whose values `cleanValue` checks one by one. */
const cookieObject = z.record(z.string(), z.unknown());

/** The cookie's touch, or null when it is absent, empty or does not decode to an object. */
export function parseFirstTouchCookie(value: string | null | undefined): FirstTouch | null {
  if (!value || value.length > MAX_COOKIE_LENGTH) return null;
  let decoded: unknown;
  try {
    const json = Buffer.from(decodeURIComponent(value), "base64url").toString("utf8");
    decoded = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = cookieObject.safeParse(decoded);
  if (!parsed.success) return null;
  const record = parsed.data;

  const touch: FirstTouch = {};
  for (const key of STRING_KEYS) {
    const cleaned = cleanValue(key, record[key]);
    if (cleaned !== undefined) touch[key] = cleaned;
  }
  const ts = typeof record.ts === "string" ? Number(record.ts) : record.ts;
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) touch.ts = Math.round(ts);
  return touch;
}

/** The value of `name` in a Cookie header, or undefined. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** The touch of a request's cookies (see `parseFirstTouchCookie`). */
export function readFirstTouch(headers: Headers | null | undefined): FirstTouch | null {
  return parseFirstTouchCookie(readCookie(headers?.get("cookie"), FIRST_TOUCH_COOKIE));
}

const GOOGLE_SOURCES = new Set(["google", "adwords", "googleads", "google_ads"]);
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);
const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "sem", "display"]);
const PAID_SOCIAL_MEDIUMS = new Set(["paid_social", "paidsocial", "paid-social", "social_paid"]);

/** Assistants that send people to sites, by the domain or utm_source they leave. */
const AI_ASSISTANTS = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "chat.mistral.ai",
  "you.com",
  "chat.deepseek.com",
  "grok.com",
];
const AI_SOURCES = new Set([
  "chatgpt",
  "chatgpt.com",
  "openai",
  "perplexity",
  "claude",
  "gemini",
  "copilot",
  "mistral",
  "le_chat",
]);

/** Search engines, by the start of their domain (google.fr, search.yahoo.com…). */
const SEARCH_ENGINE =
  /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|yandex|baidu|brave|startpage|lilo)\.[a-z.]+$/;

/** The site's own domains: a referrer from them is a visit inside the site, not a source. */
const OWN_DOMAIN = /(^|\.)louez\.io$/;

const matchesDomain = (domain: string, list: readonly string[]) =>
  list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));

/**
 * The channel a touch came by: paid Google (a click id, or google/cpc), paid Meta
 * (fbclid, or a paid-social medium), an AI assistant, a search engine, another site,
 * or none of them. No touch at all is `direct`.
 */
export function deriveAcquisitionChannel(touch: FirstTouch | null): AcquisitionChannel {
  if (!touch) return "direct";
  const source = touch.utm_source?.toLowerCase();
  const medium = touch.utm_medium?.toLowerCase();
  const referrer =
    touch.referrer_domain && !OWN_DOMAIN.test(touch.referrer_domain)
      ? touch.referrer_domain
      : undefined;

  if (touch.gclid || touch.gbraid || touch.wbraid || touch.gad_source) return "google_ads";
  if (source && GOOGLE_SOURCES.has(source) && medium && PAID_MEDIUMS.has(medium))
    return "google_ads";
  if (touch.fbclid) return "meta_ads";
  if (medium && PAID_SOCIAL_MEDIUMS.has(medium)) return "meta_ads";
  if (source && META_SOURCES.has(source) && medium && PAID_MEDIUMS.has(medium)) return "meta_ads";

  if (source && (AI_SOURCES.has(source) || matchesDomain(source, AI_ASSISTANTS)))
    return "ai_assistant";
  if (referrer && matchesDomain(referrer, AI_ASSISTANTS)) return "ai_assistant";

  if (medium === "organic") return "organic";
  if (!source && referrer && SEARCH_ENGINE.test(referrer)) return "organic";
  if (source || medium || referrer) return "referral";
  return "direct";
}

/** What `users.first_touch_attribution` keeps: the touch and its channel. */
export function firstTouchRecord(
  touch: FirstTouch | null,
): { channel: AcquisitionChannel } & FirstTouch {
  return { ...touch, channel: deriveAcquisitionChannel(touch) };
}

/**
 * The keys `account_created` also carries under their own, standard name: PostHog's
 * Marketing Analytics matches ad spend to a conversion event by its `utm_campaign`
 * (and `utm_source`…), so the cost per account needs them on the event itself.
 */
const STANDARD_EVENT_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
] as const satisfies readonly StringKey[];

/**
 * The properties of `account_created`: each touch field prefixed `first_touch_`, the
 * utm fields and the gclid under their standard names too (`STANDARD_EVENT_KEYS`), the
 * derived `acquisition_channel`, and whether the cookie was there. Only the
 * `first_touch_` ones are set once on the person (`$set_once`): standard names on the
 * person would read as its latest visit, which PostHog's own `utm_*` already are. The
 * person's channel is `first_touch_acquisition_channel`: `acquisition_channel` on the
 * person is the channel the owner reports in the onboarding (acquisition_channel_reported).
 */
export function firstTouchEventProperties(touch: FirstTouch | null): Record<string, unknown> {
  const channel = deriveAcquisitionChannel(touch);
  const prefixed: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(touch ?? {})) {
    if (value !== undefined) prefixed[`first_touch_${key}`] = value;
  }
  const standard: Record<string, string> = {};
  for (const key of STANDARD_EVENT_KEYS) {
    const value = touch?.[key];
    if (value !== undefined) standard[key] = value;
  }
  return {
    ...prefixed,
    ...standard,
    acquisition_channel: channel,
    attribution_cookie_present: touch !== null,
    $set_once: {
      ...prefixed,
      first_touch_acquisition_channel: channel,
    },
  };
}
