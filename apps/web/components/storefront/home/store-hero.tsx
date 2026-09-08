import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import { HeroImageSlider } from "@/components/storefront/home/hero-image-slider";
import type {
  StoreHeroAlign,
  StoreHeroShape,
  StoreHeroVerticalAlign,
} from "@/lib/utils/util.store-hero";

interface StoreHeroProps {
  name: string;
  /** One line under the name: the first sentence of the description. */
  tagline: string | null;
  /** Background or framed photos, depending on the shape. */
  backgroundImages?: string[];
  /** `cover` = text over the photos, `split` = text beside a framed photo, `band` = no photo. */
  shape: StoreHeroShape;
  align: StoreHeroAlign;
  verticalAlign: StoreHeroVerticalAlign;
  /** Status badge and rating pill. */
  badges?: ReactNode;
  /** The period search. */
  children?: ReactNode;
  /** The reassurance line, under the search. */
  footer?: ReactNode;
}

const ALIGN_ITEMS: Record<StoreHeroAlign, string> = {
  start: "items-start text-start",
  center: "items-center text-center",
  end: "items-end text-end",
};

const VERTICAL_ALIGN_ITEMS: Record<StoreHeroVerticalAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

/**
 * The scrim follows the text: it darkens the edge the headline sits on and
 * leaves the rest of the photo untinted; at the bottom it is fully clear
 * over the last 5% so the photo runs untinted into the opaque header bar.
 */
const SCRIM: Record<StoreHeroVerticalAlign, string> = {
  start: "bg-linear-to-b from-black/70 via-black/30 via-55% to-transparent to-95%",
  center: "bg-black/40",
  end: "bg-linear-to-t from-black/75 via-black/30 via-45% to-transparent to-90%",
};

/** Written out in full so Tailwind sees them. */
const SPLIT_VERTICAL_ALIGN_ITEMS: Record<StoreHeroVerticalAlign, string> = {
  start: "lg:items-start",
  center: "lg:items-center",
  end: "lg:items-end",
};

const ALIGN_JUSTIFY: Record<StoreHeroAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

/**
 * Home hero: the store's name, one line, the badges and the period search.
 *
 * `cover`: on the store photos, `min-h-[70svh]` so the inventory starts
 * before the first scroll; pulled under the header (`-mt-14 md:-mt-16`, the
 * header's own height). The scrim only carries the contrast the headline
 * needs, on the edge the text sits on.
 *
 * `split`: the text on the page surface next to the photo in a rounded
 * frame, no scrim, no white text, so a light illustration works as well as
 * a dark photo. `align` picks the side of the text column, `verticalAlign`
 * where it sits against the photo.
 *
 * `band`: no photo, so a short muted band with everything centred; nothing
 * to look at, so the inventory arrives at once.
 */
export const StoreHero = ({
  name,
  tagline,
  backgroundImages = [],
  shape,
  align,
  verticalAlign,
  badges,
  children,
  footer,
}: StoreHeroProps) => {
  const heading = (
    <h1
      id="store-hero-title"
      className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl"
    >
      {name}
    </h1>
  );

  if (shape === "split") {
    return (
      <section
        className="bg-background text-foreground"
        aria-labelledby="store-hero-title"
        data-slot="store-hero"
      >
        <div
          className={cn(
            "mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12 lg:px-8 lg:py-12",
            SPLIT_VERTICAL_ALIGN_ITEMS[verticalAlign],
          )}
        >
          <div
            className={cn(
              "relative aspect-[16/10] overflow-hidden rounded-2xl bg-muted lg:aspect-[5/4]",
              align === "end" ? "lg:order-first" : "lg:order-last",
            )}
          >
            <HeroImageSlider images={backgroundImages} />
          </div>

          <div className="flex max-w-2xl flex-col gap-4">
            {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
            {heading}
            {tagline ? (
              <p className="max-w-prose text-pretty text-base text-muted-foreground sm:text-lg">
                {tagline}
              </p>
            ) : null}
            {children ? <div className="mt-2 flex w-full">{children}</div> : null}
            {footer}
          </div>
        </div>
      </section>
    );
  }

  const cover = shape === "cover";

  return (
    <section
      className={cn(
        "relative flex overflow-hidden",
        cover
          ? cn(
              "-mt-14 min-h-[70svh] bg-foreground text-white md:-mt-16",
              VERTICAL_ALIGN_ITEMS[verticalAlign],
            )
          : "bg-muted text-foreground",
      )}
      aria-labelledby="store-hero-title"
      data-slot="store-hero"
    >
      {cover ? (
        <>
          <HeroImageSlider images={backgroundImages} />
          <div
            aria-hidden
            className={cn("pointer-events-none absolute inset-0", SCRIM[verticalAlign])}
          />
        </>
      ) : null}

      <div
        className={cn(
          "relative mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 sm:px-6 lg:px-8",
          cover ? "pt-24 pb-16 md:pb-10" : "py-10 sm:py-14",
          ALIGN_ITEMS[align],
        )}
      >
        <div className={cn("flex max-w-3xl flex-col gap-3", ALIGN_ITEMS[align])}>
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
          {heading}
          {tagline ? (
            <p
              className={cn(
                "max-w-prose text-pretty text-base sm:text-lg",
                cover ? "text-white/85" : "text-muted-foreground",
              )}
            >
              {tagline}
            </p>
          ) : null}
        </div>

        {children ? (
          <div className={cn("flex w-full", ALIGN_JUSTIFY[align])}>{children}</div>
        ) : null}
        {footer ? <div className={cn("flex w-full", ALIGN_JUSTIFY[align])}>{footer}</div> : null}
      </div>
    </section>
  );
};
