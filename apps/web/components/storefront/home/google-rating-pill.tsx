import { getLocale, getTranslations } from "next-intl/server";

import { StarIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

interface GoogleRatingPillProps {
  rating: number;
  reviewCount: number | null;
  /** `#reviews` when the reviews section renders, else the Google Maps page; nothing = plain text. */
  href: string | null;
  className?: string;
}

/** Google rating of the store as a pill; tapping it goes to the reviews. */
export const GoogleRatingPill = async ({
  rating,
  reviewCount,
  href,
  className,
}: GoogleRatingPillProps) => {
  const [t, locale] = await Promise.all([getTranslations("storefront.hero"), getLocale()]);
  const formattedRating = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating);
  const external = href !== null && !href.startsWith("#");

  const content = (
    <>
      <StarIcon aria-hidden className="size-4 fill-warning text-warning" />
      <span className="tabular-nums">{formattedRating}</span>
      {reviewCount !== null ? (
        <span className="text-xs text-muted-foreground">({reviewCount})</span>
      ) : null}
    </>
  );
  const pillClassName = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full bg-background/90 px-3 text-sm font-medium text-foreground backdrop-blur",
    className,
  );

  if (!href) {
    return (
      <span className={pillClassName} data-slot="google-rating-pill">
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={cn(pillClassName, "transition-colors hover:bg-background")}
      aria-label={t("seeReviews", { rating: formattedRating })}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      data-slot="google-rating-pill"
    >
      {content}
    </a>
  );
};
