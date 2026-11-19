import "server-only";

import { after } from "next/server";

import { classifyAiCrawler, type AiCrawlResource } from "@louez/api/contracts/ai-visibility";
import { recordAiCrawl } from "@louez/api/services/ai-visibility";

import { log } from "@/lib/evlog";

/**
 * Counts the request when an AI crawler sent it (docs/product/visibilite-boutiques.md):
 * the store, the day, which crawler and what it read, after the response is sent.
 * Nothing about the request itself is kept. A count lost is logged, never
 * an error for the page.
 */
export function countAiCrawl(input: {
  storeId: string;
  userAgent: string | null;
  resource: AiCrawlResource;
}): void {
  const crawler = classifyAiCrawler(input.userAgent);
  if (!crawler) return;
  after(() =>
    recordAiCrawl({
      storeId: input.storeId,
      crawler: crawler.key,
      resource: input.resource,
    }).catch((error: unknown) => {
      log.error({ aiCrawl: { event: "count_failed", crawler: crawler.key, error: String(error) } });
    }),
  );
}
