import { z } from "zod";

import { apiError } from "../platform/errors";
import { ANALYTICS_PERIODS, DEFAULT_ANALYTICS_PERIOD } from "./analytics";

/**
 * « Être trouvé par les IA » (docs/product/visibilite-boutiques.md, phase 3):
 * which AI assistants send visitors to a storefront, which AI crawlers read
 * it, and whether the store's data is complete enough for them to describe
 * it. No database here: the storefront (tracking, robots.txt, llms.txt) and
 * the dashboard share these lists.
 */

/** The assistants the dashboard names; `other` gathers the crawlers of smaller ones. */
export const AI_ASSISTANTS = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "copilot",
  "mistral",
  "meta_ai",
  "grok",
  "deepseek",
  "other",
] as const;
export type AiAssistant = (typeof AI_ASSISTANTS)[number];

export const aiAssistantSchema = z.enum(AI_ASSISTANTS);

/** The assistant an `ai_assistant` value names, or null for anything else. */
export const parseAiAssistant = (value: unknown): AiAssistant | null => {
  const parsed = aiAssistantSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * The hosts an assistant's answers link from (the visitor's referrer), and
 * the `utm_source` some of them add to the links they cite (ChatGPT adds
 * `chatgpt.com`, and often sends no referrer). A subdomain matches its host.
 */
const ASSISTANT_HOSTS: Readonly<Record<string, Exclude<AiAssistant, "other">>> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "perplexity.ai": "perplexity",
  "gemini.google.com": "gemini",
  "bard.google.com": "gemini",
  "copilot.microsoft.com": "copilot",
  "copilot.cloud.microsoft": "copilot",
  "chat.mistral.ai": "mistral",
  "meta.ai": "meta_ai",
  "grok.com": "grok",
  "chat.deepseek.com": "deepseek",
};

/** `utm_source` values that are an assistant's name rather than its host. */
const ASSISTANT_UTM_NAMES: Readonly<Record<string, Exclude<AiAssistant, "other">>> = {
  chatgpt: "chatgpt",
  openai: "chatgpt",
  claude: "claude",
  perplexity: "perplexity",
  gemini: "gemini",
  copilot: "copilot",
  mistral: "mistral",
  lechat: "mistral",
  grok: "grok",
  deepseek: "deepseek",
};

const assistantOfHost = (host: string): AiAssistant | null => {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  for (const [domain, assistant] of Object.entries(ASSISTANT_HOSTS)) {
    if (normalized === domain || normalized.endsWith(`.${domain}`)) return assistant;
  }
  return null;
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * The AI assistant a storefront visit came from: its referrer's host, else
 * the landing link's `utm_source`. Null for any other visit. Pure: the
 * browser runs it on the visit's first page, the tests here.
 */
export function classifyAiReferral(input: {
  referrer?: string | null;
  utmSource?: string | null;
}): AiAssistant | null {
  const referrerHost = input.referrer ? hostOf(input.referrer) : null;
  const fromReferrer = referrerHost ? assistantOfHost(referrerHost) : null;
  if (fromReferrer) return fromReferrer;

  const utm = input.utmSource?.trim().toLowerCase();
  if (!utm) return null;
  return ASSISTANT_UTM_NAMES[utm] ?? assistantOfHost(hostOf(`https://${utm}`) ?? utm);
}

/**
 * Why a crawler reads a page: to train a model, to index it for the
 * assistant's search, or right now, for a person who asked the assistant.
 */
export type AiCrawlerPurpose = "training" | "search" | "user";

export interface AiCrawler {
  /** Stored in `store_ai_crawls.crawler`. */
  key: string;
  /** The product token of its user agent, as its owner documents it. */
  token: string;
  assistant: AiAssistant;
  purpose: AiCrawlerPurpose;
}

/** The AI crawlers Louez counts, matched by their user agent's token. */
export const AI_CRAWLERS: readonly AiCrawler[] = [
  { key: "gptbot", token: "GPTBot", assistant: "chatgpt", purpose: "training" },
  { key: "oai_searchbot", token: "OAI-SearchBot", assistant: "chatgpt", purpose: "search" },
  { key: "chatgpt_user", token: "ChatGPT-User", assistant: "chatgpt", purpose: "user" },
  { key: "claudebot", token: "ClaudeBot", assistant: "claude", purpose: "training" },
  { key: "claude_searchbot", token: "Claude-SearchBot", assistant: "claude", purpose: "search" },
  { key: "claude_user", token: "Claude-User", assistant: "claude", purpose: "user" },
  { key: "perplexitybot", token: "PerplexityBot", assistant: "perplexity", purpose: "search" },
  { key: "perplexity_user", token: "Perplexity-User", assistant: "perplexity", purpose: "user" },
  {
    key: "google_cloudvertexbot",
    token: "Google-CloudVertexBot",
    assistant: "gemini",
    purpose: "user",
  },
  { key: "mistralai_user", token: "MistralAI-User", assistant: "mistral", purpose: "user" },
  {
    key: "meta_externalagent",
    token: "meta-externalagent",
    assistant: "meta_ai",
    purpose: "training",
  },
  {
    key: "meta_externalfetcher",
    token: "meta-externalfetcher",
    assistant: "meta_ai",
    purpose: "user",
  },
  { key: "duckassistbot", token: "DuckAssistBot", assistant: "other", purpose: "search" },
  { key: "amazonbot", token: "Amazonbot", assistant: "other", purpose: "search" },
  { key: "ccbot", token: "CCBot", assistant: "other", purpose: "training" },
  { key: "cohere_ai", token: "cohere-ai", assistant: "other", purpose: "training" },
];

const crawlerByKey = new Map(AI_CRAWLERS.map((crawler) => [crawler.key, crawler]));

/** The crawler a stored key names, or null for a key no longer listed. */
export const aiCrawlerOf = (key: string): AiCrawler | null => crawlerByKey.get(key) ?? null;

/** The AI crawler a request's user agent names, or null for any other client. */
export function classifyAiCrawler(userAgent: string | null | undefined): AiCrawler | null {
  if (!userAgent) return null;
  const agent = userAgent.toLowerCase();
  return AI_CRAWLERS.find((crawler) => agent.includes(crawler.token.toLowerCase())) ?? null;
}

/**
 * The tokens storefronts' robots.txt names to welcome AI crawlers. Adds the
 * tokens that are robots.txt rules only (Google-Extended, Applebot-Extended:
 * no crawler sends them, they say whether Gemini and Apple Intelligence may
 * use what Googlebot and Applebot read).
 */
export const AI_ROBOTS_TOKENS: readonly string[] = [
  ...AI_CRAWLERS.map((crawler) => crawler.token),
  "Google-Extended",
  "Applebot-Extended",
];

/** What an AI crawler read: a storefront page, or the store's llms.txt files. */
export const AI_CRAWL_RESOURCES = ["page", "llms_txt"] as const;
export type AiCrawlResource = (typeof AI_CRAWL_RESOURCES)[number];

/** How far back the dashboard counts AI visits and reads; the guide's window. */
export const AI_VISIBILITY_WINDOW_DAYS = 28;

/**
 * What an assistant needs to describe a store well, in the order the
 * dashboard lists them. Each has a one-click fix in the dashboard.
 */
export const AI_READINESS_ITEM_KEYS = [
  "description",
  "address",
  "businessHours",
  "products",
] as const;
export type AiReadinessItemKey = (typeof AI_READINESS_ITEM_KEYS)[number];

export const aiReadinessItemSchema = z.object({
  key: z.enum(AI_READINESS_ITEM_KEYS),
  ready: z.boolean(),
  /** `products` only: the active products with a photo and a price, out of all active ones. */
  count: z.object({ ready: z.number().int(), total: z.number().int() }).nullable(),
});
export type AiReadinessItem = z.infer<typeof aiReadinessItemSchema>;

export const getAiVisibilityInput = z.object({});

export const getAiVisibilityOutput = z.object({
  readiness: z.array(aiReadinessItemSchema),
  /** Visits from an assistant's answer, over the last `AI_VISIBILITY_WINDOW_DAYS` days. */
  visits: z.object({
    /** Distinct visits (storefront sessions). */
    total: z.number().int(),
    /** One entry per assistant that sent a visit, the most first. */
    byAssistant: z.array(z.object({ assistant: aiAssistantSchema, visits: z.number().int() })),
  }),
  /**
   * Reservations made online during a visit that came from an assistant, in
   * the same window, test reservations aside (see `countAiBookings`).
   */
  bookings: z.object({ total: z.number().int() }),
  /** Requests of AI crawlers over the same window: a count, never who or what page. */
  crawls: z.object({
    total: z.number().int(),
    /** Of `total`, the reads of the store's llms.txt files. */
    llmsTxt: z.number().int(),
    /** One entry per assistant whose crawlers came, the most first. */
    byAssistant: z.array(z.object({ assistant: aiAssistantSchema, hits: z.number().int() })),
  }),
});
export type AiVisibilityView = z.infer<typeof getAiVisibilityOutput>;

/** The AI sources view of Analyses, over one of the analytics periods. */
export const getAiTrafficInput = z.object({
  period: z.enum(ANALYTICS_PERIODS).default(DEFAULT_ANALYTICS_PERIOD),
});

export const getAiTrafficOutput = z.object({
  period: z.enum(ANALYTICS_PERIODS),
  /** How `series` is bucketed: days for the short periods, calendar months for the long ones. */
  granularity: z.enum(["day", "month"]),
  /** The store's time zone, at whose midnight the buckets are cut. */
  timezone: z.string(),
  visits: z.object({
    /** Distinct visits from an assistant in the period. */
    total: z.number().int(),
    /** The same over the period before, for the trend. */
    previous: z.number().int(),
    /** Every visit of the period, whatever its source. */
    all: z.number().int(),
  }),
  /** Reservations made during a visit from an assistant (`countAiBookings`). */
  bookings: z.object({ total: z.number().int() }),
  /** One point per bucket, in order: visits from an assistant, and reservations they made. */
  series: z.array(
    z.object({ start: z.date(), visits: z.number().int(), bookings: z.number().int() }),
  ),
  /** One row per assistant with a visit, a reservation or a crawler read; the most visits first. */
  byAssistant: z.array(
    z.object({
      assistant: aiAssistantSchema,
      visits: z.number().int(),
      bookings: z.number().int(),
      hits: z.number().int(),
    }),
  ),
  crawls: z.object({ total: z.number().int(), llmsTxt: z.number().int() }),
});
export type AiTrafficView = z.infer<typeof getAiTrafficOutput>;

export const aiVisibilityErrors = {
  notIncluded: () =>
    apiError("FORBIDDEN", "AI_VISIBILITY_NOT_INCLUDED", {
      message: "This store's plan does not include AI visibility.",
      i18nKey: "errors.aiVisibilityNotIncluded",
    }),
} as const;
