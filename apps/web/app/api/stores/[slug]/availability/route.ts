import { ApiServiceError, getStorefrontAvailability } from '@louez/api/services'
import { storefrontAvailabilityRouteQuerySchema } from '@louez/validations'
import { NextRequest, NextResponse } from 'next/server'

function statusFromServiceCode(code: ApiServiceError['code']) {
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    default:
      return 500
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params
    const searchParams = request.nextUrl.searchParams

    const parsed = storefrontAvailabilityRouteQuerySchema.safeParse({
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      productIds: searchParams.get('productIds'),
    })

    if (!parsed.success) {
      return NextResponse.json({ error: 'errors.invalidData' }, { status: 400 })
    }

    const productIds = parsed.data.productIds
      ? parsed.data.productIds.split(',').map((id) => id.trim()).filter(Boolean)
      : undefined

    const payload = await getStorefrontAvailability({
      storeSlug: slug,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      productIds,
    })

    const response = NextResponse.json(payload)
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return response
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return NextResponse.json(
        { error: error.key, details: error.details },
        { status: statusFromServiceCode(error.code) },
      )
    }

    console.error('Availability API error:', error)
    return NextResponse.json({ error: 'errors.internalServerError' }, { status: 500 })
  }
}
