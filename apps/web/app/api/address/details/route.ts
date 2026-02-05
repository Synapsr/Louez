import { NextRequest, NextResponse } from 'next/server'
import type { AddressDetails } from '@louez/types'

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY

/**
 * GET /api/address/details?placeId=...
 * Returns address details including coordinates from Google Places API (New)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const placeId = searchParams.get('placeId')

  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  }

  if (!GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not configured')
    return NextResponse.json({ error: 'API not configured' }, { status: 500 })
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
        },
      }
    )

    const data = await response.json()

    if (data.error) {
      console.error('Google Places Details error:', data.error)
      return NextResponse.json({ error: 'Failed to fetch address details' }, { status: 500 })
    }

    const addressComponents = data.addressComponents || []

    // Extract address components (new API format)
    const getComponent = (types: string[]): string | undefined => {
      const component = addressComponents.find((c: { types: string[] }) =>
        types.some(type => c.types.includes(type))
      )
      return component?.longText
    }

    const getComponentShort = (types: string[]): string | undefined => {
      const component = addressComponents.find((c: { types: string[] }) =>
        types.some(type => c.types.includes(type))
      )
      return component?.shortText
    }

    const details: AddressDetails = {
      placeId: data.id,
      formattedAddress: data.formattedAddress,
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      streetNumber: getComponent(['street_number']),
      street: getComponent(['route']),
      city: getComponent(['locality', 'administrative_area_level_2']),
      postalCode: getComponent(['postal_code']),
      country: getComponent(['country']),
      countryCode: getComponentShort(['country']),
    }

    return NextResponse.json({ details })
  } catch (error) {
    console.error('Error fetching address details:', error)
    return NextResponse.json({ error: 'Failed to fetch address details' }, { status: 500 })
  }
}
