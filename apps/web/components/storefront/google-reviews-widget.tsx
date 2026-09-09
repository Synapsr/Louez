"use client";

import { useRef } from "react";

import Image from "next/image";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { GoogleReview } from "@louez/types";
import { Button } from "@louez/ui";
import { StarIcon } from "@louez/ui/icons";
import { cn, formatRelativeTime } from "@louez/utils";

/** Above three cards the row scrolls; arrows help on a mouse. */
const ARROWS_FROM_COUNT = 4;
const STARS = [1, 2, 3, 4, 5] as const;

interface GoogleReviewsWidgetProps {
  reviews: GoogleReview[];
}

/** Horizontal, snapping row of review cards; one card per screen on a phone, three on desktop. */
export const GoogleReviewsWidget = ({ reviews }: GoogleReviewsWidgetProps) => {
  const t = useTranslations("storefront.reviews");
  const locale = useLocale();
  const carouselRef = useRef<HTMLUListElement>(null);

  const scrollReviews = (direction: "previous" | "next") => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction === "next" ? carousel.clientWidth : -carousel.clientWidth,
      behavior: "smooth",
    });
  };

  if (reviews.length === 0) return null;

  return (
    <div className="relative" data-slot="google-reviews-widget">
      {reviews.length >= ARROWS_FROM_COUNT ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 left-0 z-10 hidden items-center justify-between md:flex">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="pointer-events-auto size-11 -translate-x-1/2 rounded-full bg-background shadow-raised lg:size-9"
            onClick={() => scrollReviews("previous")}
            aria-label={t("previous")}
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="pointer-events-auto size-11 translate-x-1/2 rounded-full bg-background shadow-raised lg:size-9"
            onClick={() => scrollReviews("next")}
            aria-label={t("next")}
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}

      <ul
        ref={carouselRef}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:gap-4 lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {reviews.map((review) => (
          <li
            key={`${review.authorName}-${review.time}`}
            className="flex w-[85vw] shrink-0 snap-start sm:w-[360px] md:w-[calc((100%-2rem)/3)]"
          >
            <article className="flex w-full flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-6">
              <div
                className="flex items-center gap-0.5"
                role="img"
                aria-label={t("starRating", { rating: review.rating })}
              >
                {STARS.map((star) => (
                  <StarIcon
                    key={star}
                    aria-hidden
                    className={cn(
                      "size-4",
                      star <= review.rating
                        ? "fill-warning text-warning"
                        : "text-muted-foreground/40",
                    )}
                  />
                ))}
              </div>

              <p className="line-clamp-5 text-pretty text-sm text-muted-foreground sm:text-base">
                {review.text || t("noReviewText")}
              </p>

              <div className="mt-auto flex items-center gap-3">
                {review.authorPhotoBase64 || review.authorPhotoUrl ? (
                  <Image
                    src={review.authorPhotoBase64 ?? review.authorPhotoUrl ?? ""}
                    alt=""
                    width={44}
                    height={44}
                    unoptimized
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground"
                  >
                    {review.authorName.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{review.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(review.time * 1000), locale)}
                  </p>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
};
