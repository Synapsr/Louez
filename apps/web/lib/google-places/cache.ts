import { cache } from "react";

import { db } from "@louez/db";
import { googlePlacesCache } from "@louez/db";
import { eq, lt, sql } from "drizzle-orm";
import { getPlaceDetails, type PlaceDetails } from "./index";
import type { GoogleReview, ReviewBoosterSettings } from "@louez/types";
import { env } from "@/env";
import { log } from "@/lib/evlog";

// Default: 24 hours, configurable via env
const CACHE_TTL_HOURS = env.GOOGLE_PLACES_CACHE_TTL_HOURS ?? 24;

/**
 * drizzle's query error carries only the SQL and its parameters in `message`;
 * the driver's reason (duplicate key, packet too large...) is its `cause`.
 */
const toErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? error.cause.message : error.message;
};

/**
 * Fetch an image and convert to base64
 */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Process reviews to cache author photos as base64
 */
async function processReviewsWithPhotos(reviews: GoogleReview[]): Promise<GoogleReview[]> {
  return Promise.all(
    reviews.map(async (review) => {
      if (review.authorPhotoUrl && !review.authorPhotoBase64) {
        const base64 = await fetchImageAsBase64(review.authorPhotoUrl);
        return {
          ...review,
          authorPhotoBase64: base64 || undefined,
        };
      }
      return review;
    }),
  );
}

/**
 * Writes one place's cache row. An upsert on the unique `place_id`: two
 * requests that both found no row (a storefront's first visitors arrive
 * together) both write, and the second one updates instead of failing.
 * Keyed on the id the store asked for, the one every read looks up, even if
 * Google answers with a newer id for the same place.
 */
async function writeCache(
  placeId: string,
  details: PlaceDetails,
  reviews: GoogleReview[],
): Promise<void> {
  const now = new Date();
  const values = {
    name: details.name,
    address: details.address,
    rating: details.rating?.toString() || null,
    reviewCount: details.reviewCount,
    reviews,
    mapsUrl: details.mapsUrl,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000),
  };

  await db
    .insert(googlePlacesCache)
    .values({ placeId, ...values })
    .onDuplicateKeyUpdate({ set: values });
}

/**
 * Refresh cache in background (fire and forget)
 * This function does not block - it updates the cache asynchronously
 */
async function refreshCacheInBackground(placeId: string): Promise<void> {
  try {
    const fresh = await getPlaceDetails(placeId);
    if (!fresh) return;

    await writeCache(placeId, fresh, await processReviewsWithPhotos(fresh.reviews));
  } catch (error) {
    log.error("google-places", `background refresh failed: ${toErrorMessage(error)}`);
  }
}

/**
 * Get cached place details or fetch fresh from Google Places API
 * Uses stale-while-revalidate pattern: returns stale data immediately
 * and refreshes in background to avoid blocking visitors.
 *
 * Wrapped in React `cache()`: the hero rating, the reviews section and the
 * metadata of one request share a single read.
 */
export const getCachedPlaceDetails = cache(
  async (placeId: string): Promise<PlaceDetails | null> => {
    try {
      // Check cache first
      const cached = await db.query.googlePlacesCache.findFirst({
        where: eq(googlePlacesCache.placeId, placeId),
      });

      const now = new Date();

      // Return cached data if not expired
      if (cached && cached.expiresAt > now) {
        return transformCacheToDetails(cached);
      }

      // If we have stale cache, return it immediately and refresh in background
      // This implements "stale-while-revalidate" pattern
      if (cached) {
        // Trigger background refresh (fire and forget - don't await)
        refreshCacheInBackground(placeId).catch(() => {});
        // Return stale data immediately
        return transformCacheToDetails(cached);
      }

      // No cache exists - must fetch synchronously for first request
      const fresh = await getPlaceDetails(placeId);
      if (!fresh) {
        return null;
      }

      // Process reviews to cache photos as base64
      const reviewsWithPhotos = await processReviewsWithPhotos(fresh.reviews);

      // Save to cache (best effort; storefront rendering should not depend on this write)
      try {
        await writeCache(placeId, fresh, reviewsWithPhotos);
      } catch (cacheWriteError) {
        log.error("google-places", `cache write failed: ${toErrorMessage(cacheWriteError)}`);
      }

      return {
        ...fresh,
        reviews: reviewsWithPhotos,
      };
    } catch (error) {
      log.error("google-places", `cache read failed: ${toErrorMessage(error)}`);
      return null;
    }
  },
);

/**
 * Transform cache row to PlaceDetails
 */
function transformCacheToDetails(cached: {
  placeId: string;
  name: string;
  address: string | null;
  rating: string | null;
  reviewCount: number | null;
  reviews: GoogleReview[] | null;
  mapsUrl: string | null;
}): PlaceDetails {
  return {
    placeId: cached.placeId,
    name: cached.name,
    address: cached.address || "",
    rating: cached.rating ? parseFloat(cached.rating) : null,
    reviewCount: cached.reviewCount,
    reviews: cached.reviews || [],
    mapsUrl: cached.mapsUrl || `https://www.google.com/maps/place/?q=place_id:${cached.placeId}`,
  };
}

/**
 * Clean expired cache entries (can be called from a cron job)
 */
export async function cleanExpiredCache(): Promise<number> {
  const result = await db
    .delete(googlePlacesCache)
    .where(lt(googlePlacesCache.expiresAt, new Date()));
  // MySQL returns [ResultSetHeader, FieldPacket[]] - the first element has affectedRows
  const affectedRows = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  return affectedRows;
}

/**
 * Refresh Google Places cache for all active stores
 * Called by cron job to proactively update cache
 */
export async function refreshAllStoresCache(): Promise<{
  processed: number;
  refreshed: number;
  errors: string[];
}> {
  const result = {
    processed: 0,
    refreshed: 0,
    errors: [] as string[],
  };

  try {
    // Get all stores with Review Booster enabled and a Google Place ID
    const storesWithReviewBooster = await db.query.stores.findMany({
      where: sql`JSON_EXTRACT(review_booster_settings, '$.enabled') = true
                 AND JSON_EXTRACT(review_booster_settings, '$.googlePlaceId') IS NOT NULL`,
    });

    for (const store of storesWithReviewBooster) {
      const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null;
      if (!settings?.googlePlaceId) continue;

      result.processed++;

      try {
        // Force refresh by fetching fresh data
        const fresh = await getPlaceDetails(settings.googlePlaceId);
        if (!fresh) {
          result.errors.push(`Store ${store.id}: Failed to fetch place details`);
          continue;
        }

        await writeCache(
          settings.googlePlaceId,
          fresh,
          await processReviewsWithPhotos(fresh.reviews),
        );

        result.refreshed++;
      } catch (error) {
        result.errors.push(`Store ${store.id}: ${toErrorMessage(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`Global error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return result;
}
