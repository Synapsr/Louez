import type { AddressDetails, AddressSuggestion } from '@louez/types'
import { ApiServiceError } from './errors'

interface GetAddressAutocompleteParams {
  query: string
  googlePlacesApiKey?: string
}

interface GetAddressDetailsParams {
  placeId: string
  googlePlacesApiKey?: string
}

interface ResolveAddressQueryParams {
  query: string
  googlePlacesApiKey?: string
}

interface ReverseGeocodeParams {
  latitude: number
  longitude: number
}

function getGoogleApiKey(apiKey?: string): string {
  const resolved = apiKey ?? process.env.GOOGLE_PLACES_API_KEY
  if (!resolved) {
    throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.addressApiNotConfigured')
  }

  return resolved
}

export async function getAddressAutocomplete(
  params: GetAddressAutocompleteParams,
): Promise<{ suggestions: AddressSuggestion[] }> {
  const { query, googlePlacesApiKey } = params
  const apiKey = getGoogleApiKey(googlePlacesApiKey)

  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      input: query,
      includedPrimaryTypes: [
        'street_address',
        'premise',
        'route',
        'locality',
        'postal_code',
      ],
    }),
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.addressLookupFailed', data.error)
  }

  const suggestions: AddressSuggestion[] = (data.suggestions || [])
    .slice(0, 5)
    .filter((item: { placePrediction?: unknown }) => item.placePrediction)
    .map((item: {
      placePrediction: {
        placeId: string
        text: { text: string }
        structuredFormat: {
          mainText: { text: string }
          secondaryText: { text?: string }
        }
      }
    }) => ({
      placeId: item.placePrediction.placeId,
      description: item.placePrediction.text.text,
      mainText: item.placePrediction.structuredFormat.mainText.text,
      secondaryText: item.placePrediction.structuredFormat.secondaryText?.text || '',
    }))

  return { suggestions }
}

export async function resolveAddressQuery(
  params: ResolveAddressQueryParams,
): Promise<{ details: AddressDetails | null }> {
  const { query, googlePlacesApiKey } = params
  const apiKey = getGoogleApiKey(googlePlacesApiKey)

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.location,places.addressComponents',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
    }),
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.addressLookupFailed', data.error)
  }

  const place = data.places?.[0]
  if (!place) {
    return { details: null }
  }

  const addressComponents = place.addressComponents || []

  const getComponent = (types: string[]): string | undefined => {
    const component = addressComponents.find((entry: { types: string[] }) =>
      types.some((type) => entry.types.includes(type)),
    )
    return component?.longText
  }

  const getComponentShort = (types: string[]): string | undefined => {
    const component = addressComponents.find((entry: { types: string[] }) =>
      types.some((type) => entry.types.includes(type)),
    )
    return component?.shortText
  }

  return {
    details: {
      placeId: place.id,
      formattedAddress: place.formattedAddress,
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      streetNumber: getComponent(['street_number']),
      street: getComponent(['route']),
      city: getComponent(['locality', 'administrative_area_level_2']),
      postalCode: getComponent(['postal_code']),
      country: getComponent(['country']),
      countryCode: getComponentShort(['country']),
    },
  }
}

export async function getAddressDetails(
  params: GetAddressDetailsParams,
): Promise<{ details: AddressDetails }> {
  const { placeId, googlePlacesApiKey } = params
  const apiKey = getGoogleApiKey(googlePlacesApiKey)

  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
    },
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.addressLookupFailed', data.error)
  }

  const addressComponents = data.addressComponents || []

  const getComponent = (types: string[]): string | undefined => {
    const component = addressComponents.find((entry: { types: string[] }) =>
      types.some((type) => entry.types.includes(type)),
    )
    return component?.longText
  }

  const getComponentShort = (types: string[]): string | undefined => {
    const component = addressComponents.find((entry: { types: string[] }) =>
      types.some((type) => entry.types.includes(type)),
    )
    return component?.shortText
  }

  return {
    details: {
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
    },
  }
}

export async function reverseGeocode(
  params: ReverseGeocodeParams,
): Promise<{ details: AddressDetails | null }> {
  const { latitude, longitude } = params

  try {
    // Use OpenStreetMap Nominatim for reverse geocoding (free, no API key needed)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
      { headers: { 'User-Agent': 'Louez/1.0' } },
    )

    const data = await response.json()

    if (data.error || !data.display_name) {
      return { details: null }
    }

    const addr = data.address || {}

    return {
      details: {
        placeId: String(data.place_id || ''),
        formattedAddress: data.display_name,
        latitude,
        longitude,
        streetNumber: addr.house_number,
        street: addr.road,
        city: addr.city || addr.town || addr.village || addr.municipality,
        postalCode: addr.postcode,
        country: addr.country,
        countryCode: addr.country_code?.toUpperCase(),
      },
    }
  } catch {
    return { details: null }
  }
}
