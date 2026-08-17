import { z } from "zod";

import { env } from "@/env";

/**
 * Product taxonomy served by the Marketplace at
 * `GET {MARKETPLACE_URL}/api/integration/taxonomy` (public, cached upstream
 * with `s-maxage=3600`).
 *
 * The taxonomy is a convenience, never a dependency: `MARKETPLACE_URL` is
 * optional and the endpoint may be unreachable, so every failure resolves to
 * `null` and the sales-channel mapping editor falls back to a free slug input.
 */
const taxonomyResponseSchema = z.object({
  data: z.array(
    z.object({
      slug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      parentSlug: z.string().trim().min(1).nullable().catch(null),
      name: z.record(z.string(), z.string()).catch({}),
      sortOrder: z.coerce.number().int().catch(0),
    }),
  ),
});

export type MarketplaceTaxonomyCategory = z.infer<typeof taxonomyResponseSchema>["data"][number];

const TAXONOMY_PATH = "/api/integration/taxonomy";
const TAXONOMY_REVALIDATE_SECONDS = 3600;
const TAXONOMY_TIMEOUT_MS = 4000;

/**
 * Races the fetch against a timer instead of aborting it: an `AbortSignal`
 * would opt the request out of the Next.js fetch cache, and a marketplace that
 * hangs must not hold the settings page hostage.
 */
async function fetchWithTimeout(url: string): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TAXONOMY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetch(url, {
        headers: { accept: "application/json" },
        next: { revalidate: TAXONOMY_REVALIDATE_SECONDS },
      }).catch(() => null),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function fetchMarketplaceTaxonomy(): Promise<MarketplaceTaxonomyCategory[] | null> {
  const baseUrl = env.MARKETPLACE_URL;
  if (!baseUrl) {
    return null;
  }

  let url: string;
  try {
    url = new URL(TAXONOMY_PATH, baseUrl).toString();
  } catch {
    return null;
  }

  const response = await fetchWithTimeout(url);
  if (!response?.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const parsed = taxonomyResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.length === 0) {
    return null;
  }

  return parsed.data.data;
}
