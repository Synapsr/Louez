"use client";

import { useEffect, useState } from "react";

import Image from "next/image";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { useMediaQuery } from "@/hooks/use-media-query";

/** Long enough to read the headline before the photo changes. */
const AUTOPLAY_INTERVAL_MS = 6_000;

interface HeroImageSliderProps {
  images: string[];
  className?: string;
}

/**
 * Every control is a 28 px tall pill that also catches taps 8 px above and
 * below it (`before:`), so the row reads small while the targets stay 44 px
 * high. The dots sit 16 px apart (20 px with a finger): the whole strip is
 * one target zone, not four separate buttons to hunt for.
 */
const controlBaseClassName =
  "relative flex h-7 items-center justify-center rounded-full text-white transition-colors before:absolute before:inset-x-0 before:-inset-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
// Only the arrows light up on hover; a dot's own width already shows which one is active.
const arrowClassName = cn(controlBaseClassName, "w-7 pointer-coarse:w-9 hover:bg-white/15");
const dotClassName = cn(controlBaseClassName, "w-4 pointer-coarse:w-5");

/**
 * Background photos of the home hero. The first slide loads with priority
 * (it is the largest contentful paint), the others fade in. Autoplay pauses
 * on hover and never runs for a visitor who asked for reduced motion. The
 * controls are a small pill raised above whatever the parent paints over
 * the photos.
 */
export const HeroImageSlider = ({ images, className }: HeroImageSliderProps) => {
  const t = useTranslations("storefront.hero");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const count = images.length;

  useEffect(() => {
    if (count <= 1 || paused || reducedMotion) return;

    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, AUTOPLAY_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [count, paused, reducedMotion]);

  if (count === 0) return null;

  const goTo = (next: number) => setIndex((next + count) % count);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-slot="hero-image-slider"
    >
      {images.map((src, slide) => (
        <div
          key={src}
          aria-hidden={slide !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none",
            slide === index ? "opacity-100" : "opacity-0",
          )}
        >
          <Image
            src={src}
            alt=""
            fill
            priority={slide === 0}
            sizes="100vw"
            className="object-cover"
          />
        </div>
      ))}

      {count > 1 ? (
        <div
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full bg-black/35 p-0.5 backdrop-blur-sm md:right-6 md:left-auto md:translate-x-0"
          role="group"
          aria-label={t("slides")}
        >
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            className={arrowClassName}
            aria-label={t("previousImage")}
          >
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          </button>
          {images.map((src, slide) => (
            <button
              key={src}
              type="button"
              onClick={() => goTo(slide)}
              className={dotClassName}
              aria-label={t("goToImage", { index: slide + 1, count })}
              aria-current={slide === index ? "true" : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  slide === index ? "w-4 bg-white" : "w-1.5 bg-white/60",
                )}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            className={arrowClassName}
            aria-label={t("nextImage")}
          >
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
};
