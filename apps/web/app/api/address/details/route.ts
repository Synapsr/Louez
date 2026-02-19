import { ApiServiceError, getAddressDetails } from '@louez/api/services'
import { addressDetailsInputSchema } from '@louez/validations'
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

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get('placeId')

  const parsed = addressDetailsInputSchema.safeParse({ placeId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'errors.invalidData' }, { status: 400 })
  }

  try {
    return NextResponse.json(
      await getAddressDetails({
        placeId: parsed.data.placeId,
      }),
    )
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return NextResponse.json(
        { error: error.key },
        { status: statusFromServiceCode(error.code) },
      )
    }

    console.error('Address details error:', error)
    return NextResponse.json({ error: 'errors.addressLookupFailed' }, { status: 500 })
  }
}
