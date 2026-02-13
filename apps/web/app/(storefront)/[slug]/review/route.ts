import { NextResponse } from 'next/server'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { buildReviewUrl } from '@/lib/google-places'
import { getStorefrontUrl } from '@/lib/storefront-url'
import type { ReviewBoosterSettings } from '@louez/types'

/**
 * Short URL redirect to Google Review page
 * Example: https://ddm.louez.io/review -> Google Review URL
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
    columns: {
      reviewBoosterSettings: true,
    },
  })

  if (!store) {
    return NextResponse.redirect(getStorefrontUrl(slug, '/'))
  }

  const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null

  if (!settings?.googlePlaceId) {
    // Redirect to store homepage if no Google Place configured
    return NextResponse.redirect(getStorefrontUrl(slug, '/'))
  }

  const reviewUrl = buildReviewUrl(settings.googlePlaceId)
  return NextResponse.redirect(reviewUrl)
}
