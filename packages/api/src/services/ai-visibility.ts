import {
  db,
  excludeTestReservations,
  pageViews,
  products,
  reservations,
  storeAiCrawls,
  storefrontEvents,
  stores,
} from "@louez/db";
import type { BusinessHours } from "@louez/types";
import { stripHtml } from "@louez/utils";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import {
  AI_READINESS_ITEM_KEYS,
  AI_VISIBILITY_WINDOW_DAYS,
  aiCrawlerOf,
  parseAiAssistant,
  type AiAssistant,
  type AiCrawlResource,
  type AiReadinessItem,
  type AiTrafficView,
  type AiVisibilityView,
} from "../contracts/ai-visibility";
import type { AnalyticsPeriod } from "../contracts/analytics";
import { getSalesWindow, resolveTimezone, type SalesWindow } from "./sales-window";

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

  const bookings = await readAiBookings(storeId, since, now);
  const counts = productCounts[0];
  return {
    bookings: { total: bookings.length },
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

// --- Visits and reservations from assistants, over a period ----------------

/** A visit from an assistant: its session, the assistant, its first page. */
export interface AiSession {
  sessionId: string;
  assistant: AiAssistant;
  firstAt: Date;
}

/** A reservation made online during a visit from an assistant. */
export interface AiBooking {
  reservationId: string;
  assistant: AiAssistant;
  at: Date;
}

/** The visits from an assistant whose pages fall in [start, end], one per session. */
async function readAiSessions(storeId: string, start: Date, end: Date): Promise<AiSession[]> {
  const rows = await db
    .select({
      sessionId: pageViews.sessionId,
      assistant: sql<string>`MIN(${pageViews.aiAssistant})`,
      firstAt: sql<Date>`MIN(${pageViews.createdAt})`,
    })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        isNotNull(pageViews.aiAssistant),
        gte(pageViews.createdAt, start),
        lte(pageViews.createdAt, end),
      ),
    )
    .groupBy(pageViews.sessionId);
  return rows.flatMap((row) => {
    const assistant = parseAiAssistant(row.assistant);
    return assistant
      ? [{ sessionId: row.sessionId, assistant, firstAt: new Date(row.firstAt) }]
      : [];
  });
}

/**
 * Reservations made online in [start, end] during a visit from an assistant:
 * the storefront's `checkout_completed` event names the reservation, and its
 * session is one whose pages carry an assistant (from the day before `start`,
 * so a visit begun just before midnight still counts). Test reservations,
 * events without a reservation (recorded before the event named it) and
 * reservations of another store are left out; a reservation counts once.
 * It says a booking happened in a visit from an assistant, not that the
 * assistant caused it.
 */
export async function readAiBookings(
  storeId: string,
  start: Date,
  end: Date,
): Promise<AiBooking[]> {
  const sessions = await readAiSessions(storeId, new Date(start.getTime() - DAY_MS), end);
  if (sessions.length === 0) return [];
  const reservationId = sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${storefrontEvents.metadata}, '$.reservationId'))`;
  const rows = await db
    .select({
      sessionId: storefrontEvents.sessionId,
      reservationId: reservations.id,
      at: storefrontEvents.createdAt,
    })
    .from(storefrontEvents)
    .innerJoin(
      reservations,
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, storeId),
        excludeTestReservations(),
      ),
    )
    .where(
      and(
        eq(storefrontEvents.storeId, storeId),
        eq(storefrontEvents.eventType, "checkout_completed"),
        gte(storefrontEvents.createdAt, start),
        lte(storefrontEvents.createdAt, end),
        inArray(
          storefrontEvents.sessionId,
          sessions.map((session) => session.sessionId),
        ),
      ),
    );
  return toAiBookings(rows, sessions);
}

/** Each reservation once, with the assistant of the visit it was made in. Pure. */
export function toAiBookings(
  rows: readonly { sessionId: string; reservationId: string; at: Date }[],
  sessions: readonly AiSession[],
): AiBooking[] {
  const assistantOf = new Map(sessions.map((session) => [session.sessionId, session.assistant]));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const assistant = assistantOf.get(row.sessionId);
    if (!assistant || seen.has(row.reservationId)) return [];
    seen.add(row.reservationId);
    return [{ reservationId: row.reservationId, assistant, at: new Date(row.at) }];
  });
}

/** Counts per bucket of the window, in its order; a date outside every bucket is dropped. Pure. */
export function countPerBucket(dates: readonly Date[], buckets: SalesWindow["buckets"]): number[] {
  return buckets.map(
    (bucket) => dates.filter((date) => date >= bucket.start && date < bucket.end).length,
  );
}

/**
 * Visits, reservations and crawler reads per assistant, the most visits
 * first, then reservations, then reads. Pure.
 */
export function toAiTrafficByAssistant(input: {
  sessions: readonly AiSession[];
  bookings: readonly AiBooking[];
  crawls: readonly { crawler: string; hits: number | string }[];
}): AiTrafficView["byAssistant"] {
  const rows = new Map<AiAssistant, { visits: number; bookings: number; hits: number }>();
  const row = (assistant: AiAssistant) => {
    const existing = rows.get(assistant) ?? { visits: 0, bookings: 0, hits: 0 };
    rows.set(assistant, existing);
    return existing;
  };
  for (const session of input.sessions) row(session.assistant).visits += 1;
  for (const booking of input.bookings) row(booking.assistant).bookings += 1;
  for (const crawl of input.crawls) {
    const crawler = aiCrawlerOf(crawl.crawler);
    const hits = Number(crawl.hits) || 0;
    if (crawler && hits > 0) row(crawler.assistant).hits += hits;
  }
  return [...rows.entries()]
    .map(([assistant, counts]) => ({ assistant, ...counts }))
    .sort((a, b) => b.visits - a.visits || b.bookings - a.bookings || b.hits - a.hits);
}

/**
 * The AI sources view of Analyses: visits from assistants over the period,
 * against the period before and against every visit, the reservations made
 * during them, and the crawlers' reads, bucketed like the sales charts.
 */
export async function getAiTraffic(
  storeId: string,
  period: AnalyticsPeriod,
  now: Date = new Date(),
): Promise<AiTrafficView> {
  const store = await db.query.stores.findFirst({
    columns: { settings: true },
    where: eq(stores.id, storeId),
  });
  const timezone = resolveTimezone(store?.settings?.timezone);
  const window = getSalesWindow(period, now, timezone);
  const [visits, previousVisits, allVisits, bookings, crawlRows] = await Promise.all([
    readAiSessions(storeId, window.start, window.end),
    readAiSessions(storeId, window.previousStart, window.previousEnd),
    db
      .select({ visits: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})` })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          gte(pageViews.createdAt, window.start),
          lte(pageViews.createdAt, window.end),
        ),
      ),
    readAiBookings(storeId, window.start, window.end),
    db
      .select({
        crawler: storeAiCrawls.crawler,
        resource: storeAiCrawls.resource,
        hits: sql<number>`SUM(${storeAiCrawls.hits})`,
      })
      .from(storeAiCrawls)
      .where(
        and(
          eq(storeAiCrawls.storeId, storeId),
          gte(storeAiCrawls.day, crawlDayOf(window.start)),
          lte(storeAiCrawls.day, crawlDayOf(window.end)),
        ),
      )
      .groupBy(storeAiCrawls.crawler, storeAiCrawls.resource),
  ]);

  const visitCounts = countPerBucket(
    visits.map((session) => session.firstAt),
    window.buckets,
  );
  const bookingCounts = countPerBucket(
    bookings.map((booking) => booking.at),
    window.buckets,
  );
  const crawls = toCrawlsByAssistant(crawlRows);

  return {
    period,
    granularity: window.granularity,
    timezone,
    visits: {
      total: visits.length,
      previous: previousVisits.length,
      all: Number(allVisits[0]?.visits) || 0,
    },
    bookings: { total: bookings.length },
    series: window.buckets.map((bucket, index) => ({
      start: bucket.start,
      visits: visitCounts[index] ?? 0,
      bookings: bookingCounts[index] ?? 0,
    })),
    byAssistant: toAiTrafficByAssistant({ sessions: visits, bookings, crawls: crawlRows }),
    crawls: { total: crawls.total, llmsTxt: crawls.llmsTxt },
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
