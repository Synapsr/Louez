import { getLocale, getTranslations } from "next-intl/server";

import { GoogleLogo } from "@/components/storefront/home/google-logo";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import type { PlaceDetails } from "@/lib/google-places";

import { GoogleReviewsWidget } from "./google-reviews-widget";

/** Only recommendations are shown on the storefront (rule of the review booster). */
const MIN_DISPLAYED_RATING = 4;

interface GoogleReviewsSectionProps {
  /** Place details already read by the page; the section never fetches. */
  details: PlaceDetails;
}

/** Google reviews of the store, at least four stars, with a link to the rest on Google. */
export const GoogleReviewsSection = async ({ details }: GoogleReviewsSectionProps) => {
  const reviews = details.reviews.filter((review) => review.rating >= MIN_DISPLAYED_RATING);
  if (reviews.length === 0) return null;

  const [t, locale] = await Promise.all([getTranslations("storefront.reviews"), getLocale()]);
  const rating = details.rating ?? null;
  const reviewCount = details.reviewCount ?? reviews.length;
  const formattedRating =
    rating === null
      ? null
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(rating);

  return (
    <StorefrontSection id="reviews" tone="muted" aria-labelledby="google-reviews-title">
      <SectionHeader
        id="google-reviews-title"
        title={t("title")}
        action={
          <a
            href={details.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-background px-4 text-sm font-medium shadow-card transition-shadow hover:shadow-raised"
            aria-label={
              formattedRating
                ? t("ratingLink", { rating: formattedRating, count: reviewCount })
                : t("seeAllOnGoogle")
            }
          >
            <GoogleLogo className="size-5" />
            {formattedRating ? <span className="tabular-nums">{formattedRating}</span> : null}
            <span className="text-xs text-muted-foreground">({reviewCount})</span>
          </a>
        }
      />
      <GoogleReviewsWidget reviews={reviews} />
    </StorefrontSection>
  );
};
