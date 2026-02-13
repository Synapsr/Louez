/**
 * Address suggestion from Google Places Autocomplete API
 */
export interface AddressSuggestion {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

/**
 * Detailed address information from Google Places Details API
 */
export interface AddressDetails {
  placeId: string
  formattedAddress: string
  latitude: number
  longitude: number
  streetNumber?: string
  street?: string
  city?: string
  postalCode?: string
  country?: string
  countryCode?: string
}
