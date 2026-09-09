"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import Image from "next/image";

import { ExpandIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { MediaLightbox } from "@louez/ui";
import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

const IMAGE_ASPECT_RATIO = 4 / 3;
const VIDEO_ASPECT_RATIO = 16 / 9;

type GalleryItem = { kind: "image"; src: string } | { kind: "video"; src: string };

interface ProductGalleryProps {
  images: string[];
  videoUrl: string | null;
  productName: string;
  className?: string;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One snap track for every screen: swipe on phones (dots underneath),
 * thumbnails on desktop drive the same track. Any slide opens the lightbox,
 * the video included.
 */
export const ProductGallery = ({
  images,
  videoUrl,
  productName,
  className,
}: ProductGalleryProps) => {
  const t = useTranslations("storefront.product");
  const tCommon = useTranslations("common");

  const items = useMemo<GalleryItem[]>(
    () => [
      ...images.map((src): GalleryItem => ({ kind: "image", src })),
      ...(videoUrl ? [{ kind: "video", src: videoUrl } as const] : []),
    ],
    [images, videoUrl],
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  // `lightboxIndex` outlives `isLightboxOpen`: the viewer flies back to its
  // source while the closing animation runs.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [previewSources, setPreviewSources] = useState<Record<number, string>>({});
  const trackRef = useRef<HTMLUListElement | null>(null);
  // Keyed by index, not URL — the same image can legitimately appear twice.
  const slideRefs = useRef(new Map<number, HTMLElement>());

  const itemAlt = useCallback(
    (index: number) =>
      items.length > 1
        ? t("gallery.imageAlt", { name: productName, index: index + 1 })
        : productName,
    [items.length, productName, t],
  );

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  const handleTrackScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setSelectedIndex(Math.round(track.scrollLeft / track.clientWidth));
  };

  const openLightbox = (index: number) => {
    const previews: Record<number, string> = {};
    for (const [slideIndex, slide] of slideRefs.current) {
      const image = slide.querySelector("img");
      if (image?.complete && image.naturalWidth > 0) previews[slideIndex] = image.currentSrc;
    }
    setPreviewSources(previews);
    setLightboxIndex(index);
    setIsLightboxOpen(true);
  };

  const getAspectRatio = useCallback(
    (item: GalleryItem) => (item.kind === "video" ? VIDEO_ASPECT_RATIO : IMAGE_ASPECT_RATIO),
    [],
  );

  const syncLightboxIndex = useCallback((index: number) => {
    const track = trackRef.current;
    if (track) track.scrollTo({ left: index * track.clientWidth, behavior: "instant" });
  }, []);

  const resolveSource = useCallback((index: number) => slideRefs.current.get(index) ?? null, []);

  if (items.length === 0) {
    return (
      <ProductImage
        src={null}
        alt={productName}
        containerClassName={cn("w-full rounded-2xl", className)}
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ul
        ref={trackRef}
        onScroll={handleTrackScroll}
        aria-label={t("gallery.label", { name: productName })}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => (
          <li
            key={`${item.src}-${index}`}
            ref={(node) => {
              if (node) slideRefs.current.set(index, node);
              else slideRefs.current.delete(index);
            }}
            className="w-full shrink-0 snap-center"
          >
            <button
              type="button"
              onClick={() => openLightbox(index)}
              aria-label={item.kind === "video" ? t("gallery.video") : t("gallery.zoom")}
              className="relative block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.kind === "image" ? (
                <ProductImage
                  src={item.src}
                  alt={itemAlt(index)}
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  priority={index === 0}
                  inset={false}
                  className="object-cover"
                  containerClassName="w-full rounded-none"
                />
              ) : (
                <span className="relative block aspect-4/3 w-full bg-muted">
                  <video
                    src={item.src}
                    preload="metadata"
                    muted
                    playsInline
                    className="size-full object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex size-14 items-center justify-center rounded-full bg-background/90 text-foreground shadow-raised">
                      <PlayIcon aria-hidden className="ml-0.5 size-6" />
                    </span>
                  </span>
                </span>
              )}
              <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                <ExpandIcon aria-hidden className="size-3.5" />
                {items.length > 1
                  ? t("gallery.counter", { current: index + 1, total: items.length })
                  : t("gallery.zoom")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {items.length > 1 ? (
        <>
          <div className="flex justify-center lg:hidden" role="tablist">
            {items.map((item, index) => (
              <button
                key={`dot-${item.src}-${index}`}
                type="button"
                role="tab"
                aria-selected={selectedIndex === index}
                aria-current={selectedIndex === index ? "true" : undefined}
                aria-label={t("gallery.goTo", { index: index + 1 })}
                onClick={() => scrollToIndex(index)}
                className="flex size-11 items-center justify-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-full transition-[background-color] duration-200",
                    selectedIndex === index ? "bg-foreground" : "bg-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>

          <ul className="hidden gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden">
            {items.map((item, index) => (
              <li key={`thumb-${item.src}-${index}`}>
                <button
                  type="button"
                  onClick={() => scrollToIndex(index)}
                  onDoubleClick={() => openLightbox(index)}
                  aria-current={selectedIndex === index ? "true" : undefined}
                  aria-label={item.kind === "video" ? t("gallery.video") : itemAlt(index)}
                  className={cn(
                    "block shrink-0 overflow-hidden rounded-lg transition-[opacity,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedIndex === index
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                      : "opacity-70 hover:opacity-100",
                  )}
                >
                  {item.kind === "image" ? (
                    <ProductImage
                      src={item.src}
                      alt=""
                      sizes="80px"
                      containerClassName="w-20 rounded-lg"
                    />
                  ) : (
                    <span className="flex aspect-4/3 w-20 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <PlayIcon aria-hidden className="size-5" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {lightboxIndex !== null ? (
        <MediaLightbox
          items={items}
          initialIndex={lightboxIndex}
          open={isLightboxOpen}
          getItemKey={(item, index) => `${item.src}-${index}`}
          getAspectRatio={getAspectRatio}
          resolveSource={resolveSource}
          // Swiping in the viewer moves the track underneath, so closing
          // lands on the slide the visitor actually ended on.
          onIndexChange={syncLightboxIndex}
          onOpenChange={(next) => {
            if (!next) setIsLightboxOpen(false);
          }}
          onClosed={() => setLightboxIndex(null)}
          labels={{
            dialog: t("gallery.label", { name: productName }),
            close: tCommon("close"),
            previous: tCommon("previous"),
            next: tCommon("next"),
          }}
          renderItem={({ item, index }) =>
            item.kind === "image" ? (
              <>
                {previewSources[index] ? (
                  <Image
                    src={previewSources[index]}
                    alt=""
                    fill
                    unoptimized
                    loading="eager"
                    draggable={false}
                    className="object-cover"
                  />
                ) : null}
                <Image
                  src={item.src}
                  alt={itemAlt(index)}
                  fill
                  sizes="92vw"
                  draggable={false}
                  loading="eager"
                  className="object-cover"
                />
              </>
            ) : (
              <video src={item.src} controls playsInline className="size-full object-contain" />
            )
          }
        />
      ) : null}
    </div>
  );
};
