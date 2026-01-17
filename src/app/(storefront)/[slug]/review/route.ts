import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { buildReviewUrl } from '@/lib/google-places'
import type { ReviewBoosterSettings } from '@/types'

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
    return NextResponse.redirect(new URL('/', request.url))
  }

  const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null

  if (!settings?.googlePlaceId) {
    // Redirect to store homepage if no Google Place configured
    return NextResponse.redirect(new URL(`/${slug}`, request.url))
  }

  const reviewUrl = buildReviewUrl(settings.googlePlaceId)
  return NextResponse.redirect(reviewUrl)
}
