import { NextRequest, NextResponse } from 'next/server'
import type { AddressSuggestion } from '@louez/types'
import { env } from '@/env'

const GOOGLE_PLACES_API_KEY = env.GOOGLE_PLACES_API_KEY

/**
 * GET /api/address/autocomplete?query=...
 * Returns address suggestions from Google Places API (New)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('query')

  if (!query || query.length < 3) {
    return NextResponse.json({ suggestions: [] })
  }

  if (!GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not configured')
    return NextResponse.json({ suggestions: [] })
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        },
        body: JSON.stringify({
          input: query,
          includedPrimaryTypes: ['street_address', 'subpremise', 'premise', 'route'],
        }),
      }
    )

    const data = await response.json()

    if (data.error) {
      console.error('Google Places Autocomplete error:', data.error)
      return NextResponse.json({ suggestions: [] })
    }

    const suggestions: AddressSuggestion[] = (data.suggestions || [])
      .slice(0, 5)
      .filter((s: { placePrediction?: unknown }) => s.placePrediction)
      .map((s: {
        placePrediction: {
          placeId: string
          text: { text: string }
          structuredFormat: {
            mainText: { text: string }
            secondaryText: { text: string }
          }
        }
      }) => ({
        placeId: s.placePrediction.placeId,
        description: s.placePrediction.text.text,
        mainText: s.placePrediction.structuredFormat.mainText.text,
        secondaryText: s.placePrediction.structuredFormat.secondaryText?.text || '',
      }))

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error fetching address suggestions:', error)
    return NextResponse.json({ suggestions: [] })
  }
}
