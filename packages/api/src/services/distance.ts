import { ApiServiceError } from './errors'

interface GetRouteDistanceParams {
  originLatitude: number
  originLongitude: number
  destinationLatitude: number
  destinationLongitude: number
  googlePlacesApiKey?: string
}

function getGoogleApiKey(apiKey?: string): string {
  const resolved = apiKey ?? process.env.GOOGLE_PLACES_API_KEY
  if (!resolved) {
    throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.addressApiNotConfigured')
  }

  return resolved
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusKm = 6371
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusKm * c
}

function roundDistance(distanceKm: number): number {
  return Math.round(distanceKm * 100) / 100
}

export async function getRouteDistance(
  params: GetRouteDistanceParams,
): Promise<{ distanceKm: number; source: 'route' | 'haversine' }> {
  const {
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
    googlePlacesApiKey,
  } = params

  const fallbackDistanceKm = roundDistance(
    calculateHaversineDistance(
      originLatitude,
      originLongitude,
      destinationLatitude,
      destinationLongitude,
    ),
  )

  let apiKey: string
  try {
    apiKey = getGoogleApiKey(googlePlacesApiKey)
  } catch {
    return { distanceKm: fallbackDistanceKm, source: 'haversine' }
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: originLatitude,
              longitude: originLongitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destinationLatitude,
              longitude: destinationLongitude,
            },
          },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
      }),
    })

    const data = await response.json()
    const distanceMeters = data.routes?.[0]?.distanceMeters

    if (!response.ok || data.error || typeof distanceMeters !== 'number') {
      return { distanceKm: fallbackDistanceKm, source: 'haversine' }
    }

    return {
      distanceKm: roundDistance(distanceMeters / 1000),
      source: 'route',
    }
  } catch {
    return { distanceKm: fallbackDistanceKm, source: 'haversine' }
  }
}
