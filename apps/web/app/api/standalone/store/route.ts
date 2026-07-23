import { NextResponse } from 'next/server'

import { asc, eq } from 'drizzle-orm'

import { db, stores } from '@louez/db'

import { isStandaloneMode } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

/**
 * Resolve the storefront slug of a standalone instance.
 *
 * The proxy middleware cannot query the database, so it asks this route
 * (over the loopback interface) which store the root of the origin should
 * serve. The oldest fully onboarded store wins. Returns 404 while no store
 * has completed onboarding — and always in platform mode, where "the"
 * instance store is not a meaningful concept.
 */
export async function GET() {
  if (!isStandaloneMode()) {
    return new NextResponse(null, { status: 404 })
  }

  const store = await db.query.stores.findFirst({
    columns: { slug: true },
    where: eq(stores.onboardingCompleted, true),
    orderBy: [asc(stores.createdAt)],
  })

  if (!store) {
    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.json({ slug: store.slug })
}
