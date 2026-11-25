"use client";

import { useEffect, useState } from "react";

import Image from "next/image";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";
import { getYouTubeEmbedUrl } from "@louez/validations";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useYouTubeCaptionsDisabled } from "@/hooks/use-youtube-captions";

/** Long enough to read the headline before the photo changes. */
const AUTOPLAY_INTERVAL_MS = 6_000;

interface HeroImageSliderProps {
  images: string[];
  imageAlts?: Record<string, string>;
  youtubeUrl?: string | null;
  className?: string;
  storeName?: string;
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
 * Background photos and the optional video of the home hero. The first photo
 * loads with priority; the video joins the same carousel and loops in place
 * until a visitor advances. Autoplay pauses on hover and never runs for a
 * visitor who asked for reduced motion.
 */
export const HeroImageSlider = ({
  images,
  imageAlts,
  youtubeUrl,
  className,
  storeName,
}: HeroImageSliderProps) => {
  const t = useTranslations("storefront.hero");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const youtubeEmbedUrl = youtubeUrl ? getYouTubeEmbedUrl(youtubeUrl, !reducedMotion) : null;
  const slides = [
    ...images.map((src) => ({ key: `image:${src}`, kind: "image" as const, src })),
    ...(youtubeEmbedUrl
      ? [{ key: `youtube:${youtubeUrl}`, kind: "youtube" as const, src: youtubeEmbedUrl }]
      : []),
  ];
  const count = slides.length;
  const activeIndex = count > 0 ? index % count : 0;
  const videoSlideIndex = youtubeEmbedUrl ? images.length : -1;
  const youtubeIframeRef = useYouTubeCaptionsDisabled(activeIndex === videoSlideIndex);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (count <= 1 || paused || reducedMotion || activeIndex === videoSlideIndex) return;

    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, AUTOPLAY_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeIndex, count, paused, reducedMotion, videoSlideIndex]);

  if (count === 0) return null;

  const goTo = (next: number) => setIndex((next + count) % count);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden [container-type:size]", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-slot="hero-image-slider"
    >
      {slides.map((media, slide) => {
        const shouldRenderMedia =
          media.kind === "image"
            ? slide === 0 || mounted
            : slide === activeIndex && (mounted || slide === 0);
        const defaultAlt = storeName
          ? `${storeName} – Wypożyczalnia sprzętu i narzędzi`
          : "Wypożyczalnia sprzętu – Baner główny";
        const altText =
          (imageAlts && imageAlts[media.src]) ||
          (slide === 0 ? defaultAlt : `${defaultAlt} – slajd ${slide + 1}`);

        return (
          <div
            key={media.key}
            aria-hidden={slide !== activeIndex}
            className={cn(
              "absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none",
              slide === activeIndex ? "opacity-100" : "opacity-0",
            )}
          >
            {shouldRenderMedia ? (
              media.kind === "image" ? (
                <Image
                  src={media.src}
                  alt={altText}
                  fill
                  priority={slide === 0}
                  fetchPriority={slide === 0 ? "high" : "auto"}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px"
                  className="object-cover"
                />
              ) : (
                <iframe
                  src={media.src}
                  ref={youtubeIframeRef}
                  title={t("goToImage", { index: slide + 1, count })}
                  allow="autoplay; encrypted-media"
                  referrerPolicy="strict-origin-when-cross-origin"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[max(100cqh,56.25cqw)] w-[max(100cqw,177.78cqh)] max-w-none -translate-x-1/2 -translate-y-1/2 scale-[1.01] border-0"
                />
              )
            ) : null}
          </div>
        );
      })}

      {count > 1 ? (
        <div
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full bg-black/35 p-0.5 backdrop-blur-sm md:right-6 md:left-auto md:translate-x-0"
          role="group"
          aria-label={t("slides")}
        >
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            className={arrowClassName}
            aria-label={t("previousImage")}
          >
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          </button>
          {slides.map((media, slide) => (
            <button
              key={media.key}
              type="button"
              onClick={() => goTo(slide)}
              className={dotClassName}
              aria-label={t("goToImage", { index: slide + 1, count })}
              aria-current={slide === activeIndex ? "true" : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  slide === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/60",
                )}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
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
