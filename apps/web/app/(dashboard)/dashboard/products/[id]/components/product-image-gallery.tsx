"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";

import { useTranslations } from "next-intl";

import { MediaLightbox } from "@louez/ui";

import { PRODUCT_IMAGE_ASPECT_RATIO } from "@/app/(dashboard)/dashboard/products/utils/product-image-crop";
import { ProductImage } from "@/components/product/product-image";

interface ProductImageGalleryProps {
  images: string[];
  readOnly?: boolean;
}

export const ProductImageGallery = ({ images, readOnly = false }: ProductImageGalleryProps) => {
  const t = useTranslations("dashboard.products.detail.info");
  const tForm = useTranslations("dashboard.products.form");
  const tCommon = useTranslations("common");

  // `lightboxIndex` outlives `isOpen`: the viewer needs its thumbnail to fly
  // back to while the closing animation runs.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const thumbnailsRef = useRef(new Map<string, HTMLElement>());

  const resolveLightboxSource = useCallback(
    (index: number) => {
      const image = images[index];
      return image ? (thumbnailsRef.current.get(image) ?? null) : null;
    },
    [images],
  );

  const getLightboxAspectRatio = useCallback(
    (image: string) => aspectRatios[image] ?? PRODUCT_IMAGE_ASPECT_RATIO,
    [aspectRatios],
  );

  const rememberAspectRatio = (image: string, node: HTMLImageElement) => {
    if (!node.naturalWidth || !node.naturalHeight) return;
    setAspectRatios((current) =>
      current[image] ? current : { ...current, [image]: node.naturalWidth / node.naturalHeight },
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("gallery")}</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {images.map((image, index) => (
          <button
            key={image}
            type="button"
            disabled={readOnly}
            ref={(node) => {
              if (node) thumbnailsRef.current.set(image, node);
              else thumbnailsRef.current.delete(image);
            }}
            onClick={() => {
              setLightboxIndex(index);
              setIsLightboxOpen(true);
            }}
            aria-label={tForm("openImageViewer")}
            className="focus-visible:ring-ring h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-lg transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:outline-none"
          >
            <ProductImage
              src={image}
              alt={t("galleryImageAlt", { index: index + 1 })}
              sizes="112px"
              containerClassName="h-20 w-28 border"
            />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <MediaLightbox
          items={images}
          initialIndex={lightboxIndex}
          open={isLightboxOpen}
          getItemKey={(image) => image}
          getAspectRatio={getLightboxAspectRatio}
          resolveSource={resolveLightboxSource}
          onOpenChange={(next) => {
            if (!next) setIsLightboxOpen(false);
          }}
          onClosed={() => setLightboxIndex(null)}
          labels={{
            dialog: t("gallery"),
            close: tCommon("close"),
            previous: tCommon("previous"),
            next: tCommon("next"),
          }}
          renderItem={({ item, index }) => (
            <Image
              src={item}
              alt={t("galleryImageAlt", { index: index + 1 })}
              fill
              sizes="92vw"
              draggable={false}
              onLoad={(event) => rememberAspectRatio(item, event.currentTarget)}
              className="object-contain"
            />
          )}
        />
      )}
    </div>
  );
};
