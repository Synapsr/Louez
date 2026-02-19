import { getAddressAutocomplete, ApiServiceError } from '@louez/api/services'
import { addressAutocompleteInputSchema } from '@louez/validations'
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
  const query = request.nextUrl.searchParams.get('query')
  if (!query || query.length < 3) {
    return NextResponse.json({ suggestions: [] })
  }

  const parsed = addressAutocompleteInputSchema.safeParse({ query })
  if (!parsed.success) {
    return NextResponse.json({ suggestions: [] })
  }

  try {
    return NextResponse.json(
      await getAddressAutocomplete({
        query: parsed.data.query,
      }),
    )
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return NextResponse.json(
        { suggestions: [], error: error.key },
        { status: statusFromServiceCode(error.code) },
      )
    }

    console.error('Address autocomplete error:', error)
    return NextResponse.json({ suggestions: [] }, { status: 500 })
  }
}
