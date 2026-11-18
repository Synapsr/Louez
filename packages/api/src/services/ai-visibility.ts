import { db, pageViews, products, storeAiCrawls, stores } from "@louez/db";
import type { BusinessHours } from "@louez/types";
import { stripHtml } from "@louez/utils";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

import {
  AI_READINESS_ITEM_KEYS,
  AI_VISIBILITY_WINDOW_DAYS,
  aiCrawlerOf,
  parseAiAssistant,
  type AiAssistant,
  type AiCrawlResource,
  type AiReadinessItem,
  type AiVisibilityView,
} from "../contracts/ai-visibility";

/**
 * « Être trouvé par les IA » (docs/product/visibilite-boutiques.md, phase 3):
 * whether the store's data lets an assistant describe it, the visits
 * assistants sent, and how often their crawlers read the storefront.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A store description shorter than this says too little for an assistant to
 * tell what the store rents ("Location", "Bienvenue !").
 */
const MIN_DESCRIPTION_LENGTH = 40;

export interface AiReadinessFacts {
  description: string | null;
  tagline: string | null;
  address: string | null;
  businessHours: BusinessHours | null | undefined;
  /** Active products, and those with a photo and a price above zero. */
  products: { total: number; complete: number };
}

/** Hours an assistant can repeat: switched on, with one open day. */
const hasOpeningHours = (hours: BusinessHours | null | undefined): boolean =>
  Boolean(
    hours?.enabled &&
    Object.values(hours.schedule ?? {}).some(
      (day) => day?.isOpen && Array.isArray(day.ranges) && day.ranges.length > 0,
    ),
  );

/** The readiness items, in the dashboard's order. Pure. */
export function buildAiReadiness(facts: AiReadinessFacts): AiReadinessItem[] {
  const text = [facts.description, facts.tagline]
    .map((value) => stripHtml(value ?? "").trim())
    .join(" ")
    .trim();
  const ready: Record<(typeof AI_READINESS_ITEM_KEYS)[number], boolean> = {
    description: text.length >= MIN_DESCRIPTION_LENGTH,
    address: Boolean(facts.address?.trim()),
    businessHours: hasOpeningHours(facts.businessHours),
    products: facts.products.total > 0 && facts.products.complete === facts.products.total,
  };
  return AI_READINESS_ITEM_KEYS.map((key) => ({
    key,
    ready: ready[key],
    count:
      key === "products" ? { ready: facts.products.complete, total: facts.products.total } : null,
  }));
}

/** Visits per assistant, the most first; values outside `AI_ASSISTANTS` are dropped. */
export function toVisitsByAssistant(
  rows: readonly { assistant: string | null; visits: number | string }[],
): AiVisibilityView["visits"] {
  const byAssistant = rows
    .map((row) => ({ assistant: parseAiAssistant(row.assistant), visits: Number(row.visits) || 0 }))
    .filter(
      (row): row is { assistant: AiAssistant; visits: number } =>
        row.assistant !== null && row.visits > 0,
    )
    .sort((a, b) => b.visits - a.visits);
  return { total: byAssistant.reduce((sum, row) => sum + row.visits, 0), byAssistant };
}

/** Crawler reads folded per assistant, the most first; unknown crawler keys are dropped. */
export function toCrawlsByAssistant(
  rows: readonly { crawler: string; resource: string; hits: number | string }[],
): AiVisibilityView["crawls"] {
  const perAssistant = new Map<AiAssistant, number>();
  let total = 0;
  let llmsTxt = 0;
  for (const row of rows) {
    const crawler = aiCrawlerOf(row.crawler);
    const hits = Number(row.hits) || 0;
    if (!crawler || hits <= 0) continue;
    total += hits;
    if (row.resource === "llms_txt") llmsTxt += hits;
    perAssistant.set(crawler.assistant, (perAssistant.get(crawler.assistant) ?? 0) + hits);
  }
  const byAssistant = [...perAssistant.entries()]
    .map(([assistant, hits]) => ({ assistant, hits }))
    .sort((a, b) => b.hits - a.hits);
  return { total, llmsTxt, byAssistant };
}

/** The UTC day a crawl is counted on, as `store_ai_crawls.day` stores it. */
export const crawlDayOf = (date: Date): string => date.toISOString().slice(0, 10);

export async function getAiVisibility(
  storeId: string,
  now: Date = new Date(),
): Promise<AiVisibilityView> {
  const since = new Date(now.getTime() - AI_VISIBILITY_WINDOW_DAYS * DAY_MS);
  const [store, productCounts, visitRows, crawlRows] = await Promise.all([
    db.query.stores.findFirst({
      columns: { description: true, tagline: true, address: true, settings: true },
      where: eq(stores.id, storeId),
    }),
    db
      .select({
        total: sql<number>`COUNT(*)`,
        complete: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(JSON_LENGTH(${products.images}), 0) > 0 AND ${products.price} > 0 THEN 1 ELSE 0 END), 0)`,
      })
      .from(products)
      .where(and(eq(products.storeId, storeId), eq(products.status, "active"))),
    db
      .select({
        assistant: pageViews.aiAssistant,
        visits: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
      })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          isNotNull(pageViews.aiAssistant),
          gte(pageViews.createdAt, since),
        ),
      )
      .groupBy(pageViews.aiAssistant),
    db
      .select({
        crawler: storeAiCrawls.crawler,
        resource: storeAiCrawls.resource,
        hits: sql<number>`SUM(${storeAiCrawls.hits})`,
      })
      .from(storeAiCrawls)
      .where(and(eq(storeAiCrawls.storeId, storeId), gte(storeAiCrawls.day, crawlDayOf(since))))
      .groupBy(storeAiCrawls.crawler, storeAiCrawls.resource),
  ]);

  const counts = productCounts[0];
  return {
    readiness: buildAiReadiness({
      description: store?.description ?? null,
      tagline: store?.tagline ?? null,
      address: store?.address ?? null,
      businessHours: store?.settings?.businessHours,
      products: { total: Number(counts?.total) || 0, complete: Number(counts?.complete) || 0 },
    }),
    visits: toVisitsByAssistant(visitRows),
    crawls: toCrawlsByAssistant(crawlRows),
  };
}

/**
 * Counts one read of a storefront by an AI crawler: one row per store, day,
 * crawler and resource, its `hits` incremented.
 */
export async function recordAiCrawl(input: {
  storeId: string;
  crawler: string;
  resource: AiCrawlResource;
  now?: Date;
}): Promise<void> {
  await db
    .insert(storeAiCrawls)
    .values({
      storeId: input.storeId,
      day: crawlDayOf(input.now ?? new Date()),
      crawler: input.crawler,
      resource: input.resource,
      hits: 1,
    })
    .onDuplicateKeyUpdate({ set: { hits: sql`${storeAiCrawls.hits} + 1` } });
}
