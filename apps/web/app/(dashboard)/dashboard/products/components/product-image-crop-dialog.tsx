'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  RefreshCcwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PercentCrop, PixelCrop } from 'react-image-crop';
import ReactCrop from 'react-image-crop';

import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Slider,
} from '@louez/ui';

import type { ProductImageCropQueueItem } from '../hooks/use-product-form-media';
import {
  createCroppedDataUrl,
  getCropSizePercentFromRect,
  getPixelCropFromPercentRect,
  normalizePercentCropRect,
  PRODUCT_IMAGE_ASPECT_RATIO,
  scaleCropRectToPercent,
  type ProductImagePercentCropRect,
  type ProductImagePixelCropRect,
} from '../utils/product-image-crop';

const CROP_SIZE_STEP = 10;
const CROP_SIZE_MIN = 20;
const CROP_SIZE_MAX = 100;

interface ProductImageCropDialogProps {
  open: boolean;
  items: ProductImageCropQueueItem[];
  selectedIndex: number;
  previewProductName: string;
  previewPrice: string;
  previewPriceLabel: string;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  isUploading: boolean;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onCropChange: (itemId: string, crop: ProductImagePercentCropRect) => void;
  onCropComplete: (
    itemId: string,
    croppedAreaPixels: ProductImagePixelCropRect,
  ) => void;
  onCropSizeChange: (itemId: string, cropSizePercent: number) => void;
  onApplyCrop: () => void | Promise<void>;
  onSkipCrop: () => void | Promise<void>;
  onReplaceCurrentImage: (file: File) => void | Promise<void>;
}

function toPercentCropRect(
  crop: PercentCrop,
  fallback: ProductImagePercentCropRect,
): ProductImagePercentCropRect {
  return normalizePercentCropRect(
    {
      unit: '%',
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
    },
    fallback,
  );
}

function isSamePixelCrop(
  a: ProductImagePixelCropRect | null,
  b: ProductImagePixelCropRect | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ProductImageCropDialog({
  open,
  items,
  selectedIndex,
  previewProductName,
  previewPrice,
  previewPriceLabel,
  canGoToPrevious,
  canGoToNext,
  isUploading,
  onClose,
  onSelectIndex,
  onPrevious,
  onNext,
  onCropChange,
  onCropComplete,
  onCropSizeChange,
  onApplyCrop,
  onSkipCrop,
  onReplaceCurrentImage,
}: ProductImageCropDialogProps) {
  const t = useTranslations('dashboard.products.form');
  const tCommon = useTranslations('common');
  const currentItem = items[selectedIndex] ?? null;
  const isMultiImageSession = items.length > 1;

  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const editorImageRef = useRef<HTMLImageElement | null>(null);
  const replaceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [previewFrameSize, setPreviewFrameSize] = useState({
    width: 0,
    height: 0,
  });
  const [committedPreviewCrop, setCommittedPreviewCrop] =
    useState<ProductImagePixelCropRect | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const lastCommittedCropRef = useRef<ProductImagePixelCropRect | null>(null);
  const previewCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const node = previewFrameRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setPreviewFrameSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentItem?.id, open]);

  useEffect(() => {
    const initialPreviewCrop = currentItem?.croppedAreaPixels ?? null;
    lastCommittedCropRef.current = initialPreviewCrop;
    setCommittedPreviewCrop(initialPreviewCrop);
  }, [currentItem?.id, currentItem?.croppedAreaPixels]);

  useEffect(() => {
    if (!currentItem || !committedPreviewCrop) {
      setPreviewDataUrl(null);
      return;
    }

    let active = true;
    void createCroppedDataUrl({
      imageSrc: currentItem.originalDataUrl,
      croppedAreaPixels: committedPreviewCrop,
      mimeType: currentItem.mimeType,
      quality: 0.88,
    })
      .then((nextPreviewDataUrl) => {
        if (active) setPreviewDataUrl(nextPreviewDataUrl);
      })
      .catch(() => {
        if (active) setPreviewDataUrl(null);
      });

    return () => {
      active = false;
    };
  }, [committedPreviewCrop, currentItem]);

  const clearPendingPreviewCommit = useCallback(() => {
    if (previewCommitTimeoutRef.current) {
      clearTimeout(previewCommitTimeoutRef.current);
      previewCommitTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingPreviewCommit, [clearPendingPreviewCommit]);

  useEffect(() => {
    clearPendingPreviewCommit();
  }, [clearPendingPreviewCommit, currentItem?.id]);

  const commitPreviewCrop = useCallback(
    (cropPixels: ProductImagePixelCropRect) => {
      if (!currentItem) return;
      if (isSamePixelCrop(lastCommittedCropRef.current, cropPixels)) return;
      lastCommittedCropRef.current = cropPixels;
      setCommittedPreviewCrop(cropPixels);
      onCropComplete(currentItem.id, cropPixels);
    },
    [currentItem, onCropComplete],
  );

  const schedulePreviewCommit = useCallback(
    (cropPixels: ProductImagePixelCropRect) => {
      clearPendingPreviewCommit();
      previewCommitTimeoutRef.current = setTimeout(() => {
        previewCommitTimeoutRef.current = null;
        commitPreviewCrop(cropPixels);
      }, 180);
    },
    [clearPendingPreviewCommit, commitPreviewCrop],
  );

  const getNaturalPixelCropFromRenderedCrop = useCallback(
    (renderedCrop: PixelCrop): ProductImagePixelCropRect | null => {
      if (!currentItem) return null;
      const image = editorImageRef.current;
      if (!image) return null;

      const rect = image.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const scaleX = currentItem.imageSize.width / rect.width;
      const scaleY = currentItem.imageSize.height / rect.height;
      const width = Math.max(1, Math.round(renderedCrop.width * scaleX));
      const height = Math.max(1, Math.round(renderedCrop.height * scaleY));
      const x = Math.round(renderedCrop.x * scaleX);
      const y = Math.round(renderedCrop.y * scaleY);

      return {
        x: clamp(x, 0, Math.max(0, currentItem.imageSize.width - width)),
        y: clamp(y, 0, Math.max(0, currentItem.imageSize.height - height)),
        width,
        height,
      };
    },
    [currentItem],
  );

  const handleZoomChange = useCallback(
    (nextPercent: number) => {
      if (!currentItem) return;
      const normalizedPercent = Math.round(
        Math.max(CROP_SIZE_MIN, Math.min(CROP_SIZE_MAX, nextPercent)),
      );
      const nextCrop = scaleCropRectToPercent({
        crop: currentItem.crop,
        imageSize: currentItem.imageSize,
        cropSizePercent: normalizedPercent,
        aspect: PRODUCT_IMAGE_ASPECT_RATIO,
      });
      const nextPixels = getPixelCropFromPercentRect(
        nextCrop,
        currentItem.imageSize,
      );

      onCropChange(currentItem.id, nextCrop);
      onCropSizeChange(currentItem.id, normalizedPercent);
      commitPreviewCrop(nextPixels);
    },
    [commitPreviewCrop, currentItem, onCropChange, onCropSizeChange],
  );

  const handleZoomIn = useCallback(() => {
    if (!currentItem) return;
    handleZoomChange(currentItem.cropSizePercent - CROP_SIZE_STEP);
  }, [currentItem, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    if (!currentItem) return;
    handleZoomChange(currentItem.cropSizePercent + CROP_SIZE_STEP);
  }, [currentItem, handleZoomChange]);

  const handleReplaceImage = useCallback(() => {
    replaceImageInputRef.current?.click();
  }, []);

  const handleReplaceImageChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void onReplaceCurrentImage(file);
      }
      event.target.value = '';
    },
    [onReplaceCurrentImage],
  );

  const handleCropChange = useCallback(
    (renderedCrop: PixelCrop, percentCrop: PercentCrop) => {
      if (!currentItem) return;
      const nextCrop = toPercentCropRect(percentCrop, currentItem.crop);
      const nextPixels =
        getNaturalPixelCropFromRenderedCrop(renderedCrop) ??
        getPixelCropFromPercentRect(nextCrop, currentItem.imageSize);
      onCropChange(currentItem.id, nextCrop);
      onCropSizeChange(
        currentItem.id,
        getCropSizePercentFromRect(nextCrop, currentItem.imageSize),
      );
      schedulePreviewCommit(nextPixels);
    },
    [
      currentItem,
      getNaturalPixelCropFromRenderedCrop,
      onCropChange,
      onCropSizeChange,
      schedulePreviewCommit,
    ],
  );

  const handleCropComplete = useCallback(
    (renderedCrop: PixelCrop, percentCrop: PercentCrop) => {
      if (!currentItem) return;
      const nextCrop = toPercentCropRect(percentCrop, currentItem.crop);
      const nextPixels =
        getNaturalPixelCropFromRenderedCrop(renderedCrop) ??
        getPixelCropFromPercentRect(nextCrop, currentItem.imageSize);
      clearPendingPreviewCommit();
      commitPreviewCrop(nextPixels);
    },
    [
      clearPendingPreviewCommit,
      commitPreviewCrop,
      currentItem,
      getNaturalPixelCropFromRenderedCrop,
    ],
  );

  const previewImageStyle = useMemo(() => {
    if (!currentItem) return null;
    if (!committedPreviewCrop) return null;
    if (previewFrameSize.width <= 0 || previewFrameSize.height <= 0) return null;

    const area = committedPreviewCrop;
    if (area.width <= 0 || area.height <= 0) return null;

    const scale = previewFrameSize.width / area.width;
    const width = currentItem.imageSize.width * scale;
    const height = currentItem.imageSize.height * scale;
    const x = -area.x * scale;
    const y = -area.y * scale;

    return {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(${x}px, ${y}px, 0)`,
    };
  }, [committedPreviewCrop, currentItem, previewFrameSize]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPopup
        className="flex max-h-[95vh] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden p-0"
        bottomStickOnMobile={false}
      >
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>{t('cropDialogTitle')}</DialogTitle>
          <DialogDescription>{t('cropDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-5">
          {currentItem ? (
            <>
              {isMultiImageSession ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-muted-foreground text-sm font-medium">
                      {t('cropCounter', {
                        current: selectedIndex + 1,
                        total: items.length,
                      })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onPrevious}
                        disabled={!canGoToPrevious || isUploading}
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                        {t('cropPrevious')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onNext}
                        disabled={!canGoToNext || isUploading}
                      >
                        {t('cropNext')}
                        <ChevronRightIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {items.map((item, index) => {
                      const isActive = index === selectedIndex;
                      const statusLabel =
                        item.resultMode === 'cropped'
                          ? t('cropStatusCropped')
                          : t('cropStatusOriginal');

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectIndex(index)}
                          className={`group bg-card relative w-28 shrink-0 overflow-hidden rounded-lg border text-left transition ${
                            isActive
                              ? 'border-primary ring-primary/20 ring-2'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.originalDataUrl}
                            alt={t('cropThumbnailAlt', { index: index + 1 })}
                            className="h-16 w-full object-cover"
                          />
                          <div className="space-y-1 p-2">
                            <p className="text-xs font-medium">
                              {t('cropThumbnailAlt', { index: index + 1 })}
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              {statusLabel}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid min-h-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
                    <div className="flex min-h-[56vh] items-center justify-center overflow-hidden rounded-xl bg-zinc-950 p-2">
                      <ReactCrop
                        crop={currentItem.crop}
                        keepSelection
                        aspect={PRODUCT_IMAGE_ASPECT_RATIO}
                        minWidth={48}
                        minHeight={36}
                        className="product-image-crop max-h-[72vh] max-w-full"
                        onChange={handleCropChange}
                        onComplete={handleCropComplete}
                        ruleOfThirds
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={editorImageRef}
                          src={currentItem.originalDataUrl}
                          alt={t('cropThumbnailAlt', { index: selectedIndex + 1 })}
                          className="max-h-[72vh] max-w-full select-none"
                          draggable={false}
                        />
                      </ReactCrop>
                    </div>
                  </div>

                  <div className="bg-card flex flex-col gap-4 rounded-2xl border p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">{t('cropSize')}</p>
                      <p className="text-muted-foreground text-xs">
                        {currentItem.cropSizePercent}%
                      </p>
                    </div>

                    <div className="flex justify-start">
                      <input
                        ref={replaceImageInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleReplaceImageChange}
                        disabled={isUploading}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReplaceImage}
                        disabled={isUploading}
                      >
                        <RefreshCcwIcon className="h-4 w-4" />
                        {tCommon('edit')}
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleZoomOut}
                        disabled={
                          currentItem.cropSizePercent >= CROP_SIZE_MAX ||
                          isUploading
                        }
                        aria-label={t('cropZoom')}
                      >
                        <ZoomOutIcon className="h-4 w-4" />
                      </Button>

                      <Slider
                        value={currentItem.cropSizePercent}
                        min={CROP_SIZE_MIN}
                        max={CROP_SIZE_MAX}
                        step={1}
                        onValueChange={(value) => {
                          const next = Array.isArray(value) ? value[0] : value;
                          if (typeof next === 'number') {
                            handleZoomChange(next);
                          }
                        }}
                      />

                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleZoomIn}
                        disabled={
                          currentItem.cropSizePercent <= CROP_SIZE_MIN ||
                          isUploading
                        }
                        aria-label={t('cropZoom')}
                      >
                        <ZoomInIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{t('cropPreviewTitle')}</p>
                    <p className="text-muted-foreground text-xs">
                      {t('cropPreviewDescription')}
                    </p>
                  </div>

                  <div className="bg-card rounded-2xl border p-3 shadow-sm">
                    <div
                      ref={previewFrameRef}
                      className="bg-muted relative aspect-[4/3] overflow-hidden rounded-xl"
                    >
                      {previewDataUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewDataUrl}
                            alt={t('cropThumbnailAlt', {
                              index: selectedIndex + 1,
                            })}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 ring-1 ring-black/10" />
                        </>
                      ) : previewImageStyle ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={currentItem.originalDataUrl}
                            alt={t('cropThumbnailAlt', {
                              index: selectedIndex + 1,
                            })}
                            className="absolute top-0 left-0 max-w-none select-none"
                            style={previewImageStyle}
                          />
                          <div className="absolute inset-0 ring-1 ring-black/10" />
                        </>
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={currentItem.originalDataUrl}
                            alt={t('cropThumbnailAlt', {
                              index: selectedIndex + 1,
                            })}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 ring-1 ring-black/10" />
                        </>
                      )}
                    </div>

                    <div className="space-y-1 pt-3">
                      <p className="line-clamp-2 text-sm font-semibold">
                        {previewProductName}
                      </p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-primary text-base font-bold">
                          {previewPrice}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {previewPriceLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={onSkipCrop}
                        disabled={isUploading}
                      >
                        {t('cropSkip')}
                      </Button>
                      <Button
                        variant="default"
                        onClick={onApplyCrop}
                        disabled={isUploading}
                      >
                        {t('cropApply')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex min-h-40 items-center justify-center">
              <ImageIcon className="mr-2 h-5 w-5" />
              <span>{t('cropNoImage')}</span>
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
