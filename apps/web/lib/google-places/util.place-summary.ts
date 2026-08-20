import type { ReviewBoosterSettings } from "@louez/types";

import type { PlaceDetails } from "./index";

export function mergeCurrentPlaceDetails(
  settings: ReviewBoosterSettings | null,
  details: PlaceDetails | null,
): ReviewBoosterSettings | null {
  if (!settings || !details || settings.googlePlaceId !== details.placeId) {
    return settings;
  }

  return {
    ...settings,
    googlePlaceName: details.name,
    googlePlaceAddress: details.address,
    googleRating: details.rating,
    googleReviewCount: details.reviewCount,
  };
}
