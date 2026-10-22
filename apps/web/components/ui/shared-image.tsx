"use client";

import Image, { type ImageProps } from "next/image";
import { type ComponentType, type ReactNode, useCallback, useState } from "react";

import { ImageIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import { canOptimizeImage } from "@/lib/storage/image-optimizer";

export type SharedImageProps = Omit<ImageProps, "src"> & {
  /** A missing source renders the fallback instead of a broken image. */
  src: ImageProps["src"] | null | undefined;
  /** Hairline inner border painted above the image, to give it some depth. */
  inset?: boolean;
  /** Fade the image in once it has loaded. */
  fadeIn?: boolean;
  /** Icon shown when there is no source or the load failed. */
  fallbackIcon?: ComponentType<{ className?: string }>;
  /** Replaces the whole fallback content, icon included. */
  fallback?: ReactNode;
  /** Wrapper classes — sizing, radius and background. The inset overlay inherits its radius. */
  containerClassName?: string;
};

const toCssSize = (value: ImageProps["width"]) =>
  typeof value === "string" ? Number(value) : value;

export const SharedImage = ({
  src,
  inset = false,
  fadeIn = true,
  fallbackIcon: FallbackIcon = ImageIcon,
  fallback,
  containerClassName,
  className,
  fill,
  width,
  height,
  onLoad,
  onError,
  ...imageProps
}: SharedImageProps) => {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [renderedSrc, setRenderedSrc] = useState(src);

  // Reset during render rather than in an effect, so a new source never keeps
  // the previous one's error or fade state.
  if (renderedSrc !== src) {
    setRenderedSrc(src);
    setStatus("loading");
  }

  // Stable identity, otherwise React re-runs the callback on every render.
  const markLoadedIfComplete = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setStatus("loaded");
  }, []);

  const showsFallback = !src || status === "error";
  const isPending = fadeIn && !showsFallback && status !== "loaded";

  return (
    <div
      className={cn(
        "bg-muted relative overflow-hidden",
        // `fill` images are absolutely positioned, so the wrapper is sized by the caller.
        !fill && "w-fit",
        containerClassName,
      )}
    >
      {showsFallback ? (
        <div
          className={cn(
            "text-muted-foreground flex items-center justify-center",
            fill ? "absolute inset-0" : "size-full",
            className,
          )}
          // Keeps the box from collapsing when the image never renders.
          style={fill ? undefined : { width: toCssSize(width), height: toCssSize(height) }}
        >
          {/* Sized as a fraction of the box, so one component covers 32px thumbs and hero images. */}
          {fallback ?? <FallbackIcon className="size-1/3 max-h-8 min-h-3 max-w-8 min-w-3" />}
        </div>
      ) : (
        <Image
          {...imageProps}
          src={src}
          unoptimized={imageProps.unoptimized || !canOptimizeImage(src)}
          fill={fill}
          width={width}
          height={height}
          // A cached image can finish loading before React attaches `onLoad`.
          ref={markLoadedIfComplete}
          onLoad={(event) => {
            setStatus("loaded");
            onLoad?.(event);
          }}
          onError={(event) => {
            setStatus("error");
            onError?.(event);
          }}
          className={cn(
            "object-cover",
            fadeIn && "transition-opacity duration-300",
            isPending && "opacity-0",
            className,
          )}
        />
      )}
      {inset && (
        <div
          aria-hidden="true"
          className={cn(
            "inset-ring-1 inset-ring-black/15 dark:inset-ring-white/10 pointer-events-none absolute inset-0 rounded-[inherit]",
            fadeIn && "transition-opacity duration-300",
            isPending && "opacity-0",
          )}
        />
      )}
    </div>
  );
};
