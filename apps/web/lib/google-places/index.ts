import type { GoogleReview } from '@louez/types'

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY

export interface PlaceSearchResult {
  placeId: string
  name: string
  address: string
  rating?: number
  reviewCount?: number
  photoUrl?: string
}

/**
 * Build a photo URL from a Google Places photo reference
 */
function buildPhotoUrl(photoReference: string, maxWidth = 100): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${GOOGLE_PLACES_API_KEY}`
}

export interface PlaceDetails {
  placeId: string
  name: string
  address: string
  rating: number | null
  reviewCount: number | null
  reviews: GoogleReview[]
  mapsUrl: string
}

/**
 * Search for places using Google Places API Text Search
 */
export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  if (!GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not configured')
    return []
  }

  if (!query || query.length < 2) {
    return []
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json')
    url.searchParams.set('query', query)
    url.searchParams.set('type', 'establishment')
    url.searchParams.set('key', GOOGLE_PLACES_API_KEY)

    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Google Places API error:', data.status, data.error_message)
      return []
    }

    return (data.results || []).slice(0, 5).map((result: {
      place_id: string
      name: string
      formatted_address: string
      rating?: number
      user_ratings_total?: number
      photos?: { photo_reference: string }[]
    }) => ({
      placeId: result.place_id,
      name: result.name,
      address: result.formatted_address,
      rating: result.rating,
      reviewCount: result.user_ratings_total,
      photoUrl: result.photos?.[0]?.photo_reference
        ? buildPhotoUrl(result.photos[0].photo_reference)
        : undefined,
    }))
  } catch (error) {
    console.error('Error searching Google Places:', error)
    return []
  }
}

/**
 * Get place details including reviews
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not configured')
    return null
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
    url.searchParams.set('place_id', placeId)
    url.searchParams.set('fields', 'place_id,name,formatted_address,rating,user_ratings_total,reviews,url')
    url.searchParams.set('reviews_sort', 'newest')
    url.searchParams.set('reviews_no_translations', 'true')
    url.searchParams.set('key', GOOGLE_PLACES_API_KEY)

    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.status !== 'OK') {
      console.error('Google Places API error:', data.status, data.error_message)
      return null
    }

    const result = data.result

    const reviews: GoogleReview[] = (result.reviews || []).slice(0, 5).map((review: {
      author_name: string
      profile_photo_url?: string
      rating: number
      text: string
      relative_time_description: string
      time: number
    }) => ({
      authorName: review.author_name,
      authorPhotoUrl: review.profile_photo_url,
      rating: review.rating,
      text: review.text,
      relativeTimeDescription: review.relative_time_description,
      time: review.time,
    }))

    return {
      placeId: result.place_id,
      name: result.name,
      address: result.formatted_address,
      rating: result.rating || null,
      reviewCount: result.user_ratings_total || null,
      reviews,
      mapsUrl: result.url || buildMapsUrl(placeId),
    }
  } catch (error) {
    console.error('Error fetching Google Place details:', error)
    return null
  }
}

/**
 * Build Google Maps profile URL for a place
 */
export function buildMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`
}

/**
 * Build Google Maps review URL for leaving a review
 */
export function buildReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`
}
