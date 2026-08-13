'use client';

import { useCallback, useRef, useState } from 'react';

import Image from 'next/image';

import { Expand } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MediaLightbox } from '@louez/ui';
import { cn } from '@louez/utils';

import { ProductImage } from '@/components/product/product-image';

const DEFAULT_ASPECT_RATIO = 4 / 3;

interface ProductGalleryProps {
  images: string[];
  productName: string;
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const t = useTranslations('storefront.product');
  const tCommon = useTranslations('common');

  const [selectedIndex, setSelectedIndex] = useState(0);
  // `lightboxIndex` outlives `isOpen`: the viewer needs its source element to
  // fly back to while the closing animation runs.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const mainImageRef = useRef<HTMLElement | null>(null);
  // Keyed by index, not URL — the same image can legitimately appear twice.
  const thumbnailsRef = useRef(new Map<number, HTMLElement>());

  const imageAlt = useCallback(
    (index: number) =>
      images.length > 1
        ? t('gallery.imageAlt', { name: productName, index: index + 1 })
        : productName,
    [images.length, productName, t],
  );

  // The picture on screen is the main image; its thumbnail is only the source
  // when the viewer has moved on to another one.
  const resolveLightboxSource = useCallback(
    (index: number) => {
      if (index === selectedIndex) return mainImageRef.current;
      return thumbnailsRef.current.get(index) ?? null;
    },
    [selectedIndex],
  );

  const getLightboxAspectRatio = useCallback(
    (image: string) => aspectRatios[image] ?? DEFAULT_ASPECT_RATIO,
    [aspectRatios],
  );

  const rememberAspectRatio = (image: string, node: HTMLImageElement) => {
    if (!node.naturalWidth || !node.naturalHeight) return;
    setAspectRatios((current) =>
      current[image]
        ? current
        : { ...current, [image]: node.naturalWidth / node.naturalHeight },
    );
  };

  if (images.length === 0) {
    return (
      <ProductImage
        src={null}
        alt={productName}
        containerClassName="w-full rounded-xl"
      />
    );
  }

  const openLightbox = () => {
    setLightboxIndex(selectedIndex);
    setIsLightboxOpen(true);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        ref={(node) => {
          mainImageRef.current = node;
        }}
        onClick={openLightbox}
        aria-label={t('gallery.zoom')}
        className="focus-visible:ring-ring block w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="relative block">
          <ProductImage
            src={images[selectedIndex]}
            alt={imageAlt(selectedIndex)}
            sizes="(max-width: 1024px) 100vw, 768px"
            priority
            containerClassName="w-full rounded-xl"
          />
          <span className="bg-background/80 text-muted-foreground absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
            <Expand className="size-3.5" />
            {images.length > 1
              ? t('gallery.counter', {
                  current: selectedIndex + 1,
                  total: images.length,
                })
              : t('gallery.zoom')}
          </span>
        </span>
      </button>

      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <li key={`${image}-${index}`}>
              <button
                type="button"
                ref={(node) => {
                  if (node) thumbnailsRef.current.set(index, node);
                  else thumbnailsRef.current.delete(index);
                }}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={openLightbox}
                aria-current={selectedIndex === index}
                aria-label={imageAlt(index)}
                className={cn(
                  'focus-visible:ring-ring block shrink-0 overflow-hidden rounded-lg border-2 transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  selectedIndex === index
                    ? 'border-primary'
                    : 'border-transparent hover:border-muted-foreground/50',
                )}
              >
                <ProductImage
                  src={image}
                  alt=""
                  sizes="80px"
                  containerClassName="w-20 rounded-md"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightboxIndex !== null && (
        <MediaLightbox
          items={images}
          initialIndex={lightboxIndex}
          open={isLightboxOpen}
          getItemKey={(image, index) => `${image}-${index}`}
          getAspectRatio={getLightboxAspectRatio}
          resolveSource={resolveLightboxSource}
          // Swiping in the viewer moves the gallery underneath, so closing
          // lands on the picture the visitor actually ended on.
          onIndexChange={setSelectedIndex}
          onOpenChange={(next) => {
            if (!next) setIsLightboxOpen(false);
          }}
          onClosed={() => setLightboxIndex(null)}
          labels={{
            dialog: t('gallery.label', { name: productName }),
            close: tCommon('close'),
            previous: tCommon('previous'),
            next: tCommon('next'),
          }}
          renderItem={({ item, index }) => (
            <Image
              src={item}
              alt={imageAlt(index)}
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
}
