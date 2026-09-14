import { notFound } from "next/navigation";
import { NextResponse } from "next/server";

import { buildReviewUrl } from "@/lib/google-places";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

/**
 * Short link to the store's Google review page (`https://ddm.louez.io/review`).
 * An unknown store is a 404; a store without a Google Place goes home.
 */
export const GET = async (_request: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const placeId = store.reviewBoosterSettings?.googlePlaceId;
  if (!placeId) {
    return NextResponse.redirect(getStorefrontUrl(slug, "/"));
  }

  return NextResponse.redirect(buildReviewUrl(placeId));
};
