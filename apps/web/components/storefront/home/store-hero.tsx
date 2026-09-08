import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import { HeroImageSlider } from "@/components/storefront/home/hero-image-slider";
import type { StoreHeroAlign, StoreHeroShape } from "@/lib/utils/util.store-hero";

interface StoreHeroProps {
  name: string;
  /** One line under the name: the first sentence of the description. */
  tagline: string | null;
  /** Background or framed photos, depending on the shape. */
  backgroundImages?: string[];
  /** `cover` = text over the photos, `split` = text beside a framed photo, `band` = no photo. */
  shape: StoreHeroShape;
  align: StoreHeroAlign;
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
 * header's own height). The scrim is fully clear over the last 5%, so the
 * photo runs untinted into the opaque bar instead of meeting it mid-fade,
 * and only carries the contrast the headline needs at the bottom.
 *
 * `split`: the text on the page surface next to the photo in a rounded
 * frame, no scrim, no white text, so a light illustration works as well as
 * a dark photo. `align` picks the side of the text column.
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
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-12 lg:px-8 lg:py-12">
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
          ? "-mt-14 min-h-[70svh] items-end bg-foreground text-white md:-mt-16"
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
            className="absolute inset-0 bg-linear-to-t from-black/75 via-black/30 via-45% to-transparent to-90%"
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
