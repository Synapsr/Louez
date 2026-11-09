"use client";

import { HelpCircleIcon, StarSolidIcon, VideoSolidIcon } from "@louez/ui/icons";
import type { ChangeEvent, ComponentProps, DragEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DragDropProvider, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import {
  Clock,
  Crop,
  Eraser,
  History,
  ImageUp,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { ProductImageHistory } from "@louez/types";
import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  MediaLightbox,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";
import {
  canApplyProductImageOperation,
  cn,
  findProductImageHistory,
  getProductImageProcessingKind,
} from "@louez/utils";

import { NewFeatureBadge } from "@/components/dashboard/new-feature-badge";
import { getFieldError } from "@/hooks/form/form-context";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";
import { extractYouTubeVideoId, getYouTubeThumbnailUrl } from "@/lib/youtube";

import type { ProductImageEnhanceControls } from "../hooks/use-product-image-enhance";
import type { ProductFormComponentApi } from "../types";
import { PRODUCT_IMAGE_ASPECT_RATIO } from "../utils/product-image-crop";
import { ProductImageAiLearnMoreDialog } from "./product-image-ai-learn-more";
import {
  ProductImageAiInlineStatus,
  ProductImageAiTileProgress,
} from "./product-image-ai-progress";
import { ProductImageCreditsAlert } from "./product-image-credits-hint";
import { ProductImageHistoryDrawer } from "./product-image-history-drawer";
import { ProductImageSortableItem } from "./product-image-sortable-item";

const productImageSensors: ComponentProps<typeof DragDropProvider>["sensors"] = (defaults) => [
  ...defaults.filter((sensor) => sensor !== PointerSensor),
  PointerSensor.configure({
    preventActivation: (event) =>
      event.target instanceof Element && event.target.closest("[data-no-image-drag]") !== null,
  }),
];

export interface ProductMediaFieldsProps {
  form: ProductFormComponentApi;
  imagesPreviews: string[];
  isDragging: boolean;
  isUploadingImages: boolean;
  handleImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDragEnter: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
  removeImage: (index: number) => void;
  reorderImages: (images: string[]) => void;
  recropImage: (index: number) => void;
  canRecrop: boolean;
  imageEnhance: ProductImageEnhanceControls;
  imageHistory: ProductImageHistory[];
  selectImageVersion: (index: number, versionUrl: string) => void;
  deleteImageVersion: (index: number, versionId: string) => void;
  showPhotosLabel?: boolean;
}

export function ProductMediaFields({
  form,
  imagesPreviews,
  isDragging,
  isUploadingImages,
  handleImageUpload,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  removeImage,
  reorderImages,
  recropImage,
  canRecrop,
  imageEnhance,
  imageHistory,
  selectImageVersion,
  deleteImageVersion,
  showPhotosLabel = true,
}: ProductMediaFieldsProps) {
  const t = useTranslations("dashboard.products.form");
  const tCommon = useTranslations("common");

  // `lightboxIndex` stays set until the closing animation finished, so the
  // lightbox can fly back to its thumbnail.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // The item the viewer is really showing (it owns navigation), kept in step so
  // the toolbar always acts on what the merchant sees.
  const [lightboxActiveIndex, setLightboxActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [isLearnMoreOpen, setIsLearnMoreOpen] = useState(false);
  const [isSortingImages, setIsSortingImages] = useState(false);
  const thumbnailsRef = useRef(new Map<string, HTMLImageElement>());

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxActiveIndex(index);
    setIsLightboxOpen(true);
  };

  const closeLightbox = useCallback(() => {
    setIsHistoryDrawerOpen(false);
    setIsLightboxOpen(false);
  }, []);

  // Deleting the last photo from the toolbar leaves nothing to fly back to and
  // nothing to render: drop the viewer rather than keep a mounted shell.
  useEffect(() => {
    if (imagesPreviews.length === 0) {
      setIsLightboxOpen(false);
      setLightboxIndex(null);
    }
  }, [imagesPreviews.length]);

  const resolveLightboxSource = useCallback(
    (index: number) => {
      const preview = imagesPreviews[index];
      return preview ? (thumbnailsRef.current.get(preview) ?? null) : null;
    },
    [imagesPreviews],
  );

  const getLightboxAspectRatio = useCallback(
    (preview: string) => aspectRatios[preview] ?? PRODUCT_IMAGE_ASPECT_RATIO,
    [aspectRatios],
  );

  // Tariffs always come from the server (0 = free → no pricing shown).
  const { credits } = imageEnhance;
  const showCreditsPricing = credits.enabled && credits.enhanceCredits > 0;
  // The batch price stays out of the layout: it rides the button's tooltip so
  // the cost is still disclosed before the click without a second info line.
  const batchActionTitle =
    showCreditsPricing && credits.batchTargetCount > 0
      ? t("aiActionWithCost", {
          action: t("aiEnhanceBatchAction"),
          cost: t("aiCreditsBatchEstimate", {
            credits: credits.enhanceCredits * credits.batchTargetCount,
            images: credits.batchTargetCount,
          }),
        })
      : t("aiEnhanceBatchAction");
  // "Améliorer avec l'IA — 2 crédits": the action first, the price as a tail.
  const enhanceActionTitle = showCreditsPricing
    ? t("aiActionWithCost", {
        action: t("aiEnhanceAction"),
        cost: t("aiCreditsChip", { count: credits.enhanceCredits }),
      })
    : t("aiEnhanceAction");
  const removeBackgroundActionTitle =
    credits.enabled && credits.bgRemovalCredits > 0
      ? t("aiActionWithCost", {
          action: t("removeBackgroundAction"),
          cost: t("aiCreditsChip", { count: credits.bgRemovalCredits }),
        })
      : t("removeBackgroundAction");

  const rememberAspectRatio = (preview: string, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    setAspectRatios((current) =>
      current[preview]
        ? current
        : { ...current, [preview]: image.naturalWidth / image.naturalHeight },
    );
  };

  const finishImageReorder = useCallback(
    (event: DragEndEvent) => {
      setIsSortingImages(false);
      if (event.canceled) return;

      const { source } = event.operation;
      if (!isSortable(source) || source.initialIndex === source.index) return;

      const reorderedImages = [...imagesPreviews];
      const [movedImage] = reorderedImages.splice(source.initialIndex, 1);
      if (!movedImage) return;
      reorderedImages.splice(source.index, 0, movedImage);
      reorderImages(reorderedImages);
    },
    [imagesPreviews, reorderImages],
  );

  const batchImageActions =
    imagesPreviews.length >= 2 ? (
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          isPending={imageEnhance.isRunning}
          onClick={imageEnhance.enhanceAllImages}
          disabled={imageEnhance.isRunning || imageEnhance.credits.batchTargetCount === 0}
          title={batchActionTitle}
        >
          <Sparkles data-slot="icon" />
          {t("aiEnhanceBatchAction")}
        </Button>

        {/* No batch counter here: the tiles carry the state of every photo of
            the run — queued, processing, to review. */}

        {/* The pitch — what "uniformiser" does, with before/after examples —
            lives in the dialog instead of this row. */}
        <Button
          variant="outline"
          size="icon-sm"
          className=""
          onClick={() => setIsLearnMoreOpen(true)}
        >
          <HelpCircleIcon data-slot="icon" className="" />
          {/*  {t("aiCreditsLearnMore")} */}
        </Button>
      </div>
    ) : null;

  return (
    <TooltipProvider delay={150}>
      <div className="space-y-4">
        <form.Field name="images">
          {(field) => (
            <div className="space-y-2.5">
              {showPhotosLabel && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Label>{t("photos")}</Label>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {imagesPreviews.length}/5
                    </span>
                    <NewFeatureBadge featureId="product-image-ai" />
                  </div>
                  {batchImageActions}
                </div>
              )}

              <DragDropProvider
                sensors={productImageSensors}
                onDragStart={() => setIsSortingImages(true)}
                onDragEnd={finishImageReorder}
              >
                <div className="flex flex-wrap gap-2">
                  {imagesPreviews.map((preview, index) => {
                    const enhanceStatus = imageEnhance.statusByImage[preview] ?? "idle";
                    const isTileEnhancing = enhanceStatus === "enhancing";
                    const isTileQueued = enhanceStatus === "queued";
                    const processingKind = getProductImageProcessingKind(preview);
                    const canEnhance = canApplyProductImageOperation(preview, "enhance");
                    const canRemoveBackground = canApplyProductImageOperation(
                      preview,
                      "remove-background",
                    );

                    return (
                      <ProductImageSortableItem key={preview} preview={preview} index={index}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={(node) => {
                            if (node) thumbnailsRef.current.set(preview, node);
                            else thumbnailsRef.current.delete(preview);
                          }}
                          src={preview}
                          alt={`Product image ${index + 1}`}
                          className="h-full w-full object-cover"
                          onLoad={(event) => rememberAspectRatio(preview, event.currentTarget)}
                        />
                        <button
                          type="button"
                          className="focus-visible:ring-ring absolute inset-0 cursor-grab rounded-lg active:cursor-grabbing focus-visible:ring-2 focus-visible:outline-none"
                          onClick={() => openLightbox(index)}
                          aria-label={t("openImageViewer")}
                        />
                        <div
                          className={cn(
                            "pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b from-black/40 to-transparent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                            isSortingImages &&
                              "opacity-0 group-focus-within:opacity-0 group-hover:opacity-0",
                          )}
                        />
                        <div
                          data-no-image-drag
                          className={cn(
                            "absolute top-1.5 right-1.5 z-10 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                            isSortingImages &&
                              "pointer-events-none opacity-0 group-focus-within:opacity-0 group-hover:opacity-0",
                          )}
                        >
                          {/* Always rendered: without AI it opens the promo dialog. */}
                          <TileActionButton
                            label={enhanceActionTitle}
                            onClick={() => imageEnhance.enhanceImage(preview)}
                            disabled={imageEnhance.isRunning || !canEnhance}
                            className=""
                          >
                            <WandSparkles className="size-3" />
                          </TileActionButton>
                          {imageEnhance.backgroundRemovalEnabled && (
                            <TileActionButton
                              label={removeBackgroundActionTitle}
                              onClick={() => imageEnhance.removeBackground(preview)}
                              disabled={imageEnhance.isRunning || !canRemoveBackground}
                              className=""
                            >
                              <Eraser className="size-3" />
                            </TileActionButton>
                          )}
                          {canRecrop && (
                            <TileActionButton
                              label={t("recropImage")}
                              onClick={() => recropImage(index)}
                            >
                              <Crop className="size-3" />
                            </TileActionButton>
                          )}
                          <TileActionButton
                            label={t("removeImage")}
                            onClick={() => removeImage(index)}
                            className="hover:text-destructive"
                          >
                            <X className="size-3" />
                          </TileActionButton>
                        </div>
                        {index === 0 && (
                          <Badge
                            variant="expired"
                            className="pointer-events-none absolute bottom-1.5 left-1.5 h-5 gap-1 px-1.5 text-[10px] shadow-xs backdrop-blur-sm"
                          >
                            <StarSolidIcon className="size-2.5 fill-current" />
                            {t("mainBadge")}
                          </Badge>
                        )}
                        {/* Provenance and review state share the bottom-right
                            corner: a photo enhanced twice carries both. */}
                        <div
                          data-no-image-drag
                          className="absolute right-1.5 bottom-1.5 flex items-center gap-1"
                        >
                          {processingKind && (
                            <TileBadgeWithTooltip
                              label={t(
                                processingKind === "ai-enhanced"
                                  ? "aiEnhancedBadge"
                                  : "backgroundRemovedBadge",
                              )}
                              variant={processingKind === "ai-enhanced" ? "progress" : "submitted"}
                            >
                              {processingKind === "ai-enhanced" ? (
                                <WandSparkles className="size-3" />
                              ) : (
                                <Eraser className="size-3" />
                              )}
                            </TileBadgeWithTooltip>
                          )}
                          {enhanceStatus === "awaiting-review" && (
                            <TileBadgeWithTooltip
                              label={t("aiEnhanceReadyBadge")}
                              variant="secondary"
                            >
                              <Sparkles className="size-3" />
                            </TileBadgeWithTooltip>
                          )}
                        </div>
                        {/* Claimed by a running batch, not started yet: the
                            queue is sequential, so the wait has to be visible
                            on every photo it will reach. */}
                        {isTileQueued && (
                          <div
                            className="bg-background/55 pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] backdrop-blur-[1px]"
                            aria-busy="true"
                          >
                            <Badge
                              variant="tertiary"
                              className="h-5 gap-1 px-1.5 text-[10px] shadow-xs backdrop-blur-sm"
                            >
                              <Clock className="size-2.5" />
                              {t("aiEnhanceQueuedBadge")}
                            </Badge>
                          </div>
                        )}
                        {/* Same step language as the crop dialog, compacted. */}
                        {isTileEnhancing && (
                          <div
                            data-no-image-drag
                            className="absolute inset-0 overflow-hidden rounded-[inherit]"
                          >
                            <ProductImageAiTileProgress
                              operation={imageEnhance.operationByImage[preview] ?? "enhance"}
                              onCancel={
                                imageEnhance.isCancelling ? undefined : imageEnhance.cancelRun
                              }
                              cancelLabel={t("aiCancelGeneration")}
                            />
                          </div>
                        )}
                      </ProductImageSortableItem>
                    );
                  })}

                  {imagesPreviews.length < 5 && (
                    <label
                      className={cn(
                        "group/add max-w-[calc(50%-6px)]  sm:max-w-48 w-full flex aspect-4/3 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors",
                        isUploadingImages
                          ? "border-primary/40 bg-primary/5 cursor-wait"
                          : isDragging
                            ? "border-primary bg-primary/5"
                            : "border-input bg-background hover:border-muted-foreground/40 hover:bg-accent/50",
                      )}
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full border transition-colors",
                          isDragging
                            ? "border-primary/30 bg-primary/10"
                            : "bg-muted group-hover/add:bg-background group-hover/add:border-border border-transparent",
                        )}
                      >
                        {isUploadingImages ? (
                          <Loader2 className="text-muted-foreground size-4 animate-spin" />
                        ) : (
                          <ImageUp
                            className={cn(
                              "size-4",
                              isDragging ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isDragging ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {isUploadingImages ? t("uploading") : t("addImage")}
                      </span>
                      <input
                        type="file"
                        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                        multiple
                        className="sr-only"
                        onChange={handleImageUpload}
                        disabled={isUploadingImages}
                      />
                    </label>
                  )}

                  <form.AppField name="videoUrl">
                    {(videoField) => (
                      <ProductVideoField
                        value={videoField.state.value || ""}
                        onChange={(next: string) => videoField.handleChange(next)}
                      />
                    )}
                  </form.AppField>
                </div>
              </DragDropProvider>

              {!showPhotosLabel && batchImageActions}

              <ProductImageCreditsAlert credits={imageEnhance.credits} />

              {!showPhotosLabel && (
                <p className="text-muted-foreground text-xs">
                  {t("imagesHint", { count: 5 - imagesPreviews.length })}
                </p>
              )}
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>

        <ProductImageAiLearnMoreDialog
          operation="enhance"
          open={isLearnMoreOpen}
          onClose={() => setIsLearnMoreOpen(false)}
          primaryActionLabel={t("aiEnhanceBatchAction")}
          onPrimaryAction={
            imagesPreviews.length >= 2 &&
            imageEnhance.credits.batchTargetCount > 0 &&
            !imageEnhance.credits.isExhausted
              ? imageEnhance.enhanceAllImages
              : undefined
          }
        />

        {lightboxIndex !== null && (
          <MediaLightbox
            items={imagesPreviews}
            initialIndex={lightboxIndex}
            open={isLightboxOpen}
            suspendInteractions={isHistoryDrawerOpen}
            getItemKey={(preview) => preview}
            getAspectRatio={getLightboxAspectRatio}
            resolveSource={resolveLightboxSource}
            onOpenChange={(next) => {
              if (!next) setIsLightboxOpen(false);
            }}
            onClosed={() => setLightboxIndex(null)}
            activeIndex={lightboxActiveIndex}
            onIndexChange={setLightboxActiveIndex}
            labels={{
              dialog: t("photos"),
              close: tCommon("close"),
              previous: tCommon("previous"),
              next: tCommon("next"),
            }}
            renderToolbar={({ index, item }) => (
              <ProductImageLightboxToolbar
                preview={item}
                imageEnhance={imageEnhance}
                canRecrop={canRecrop}
                enhanceLabel={enhanceActionTitle}
                removeBackgroundLabel={removeBackgroundActionTitle}
                historyLabel={t("imageHistoryAction")}
                onEnhance={() => {
                  imageEnhance.enhanceImage(item);
                  closeLightbox();
                }}
                onRemoveBackground={() => {
                  imageEnhance.removeBackground(item);
                  closeLightbox();
                }}
                onRecrop={() => {
                  closeLightbox();
                  recropImage(index);
                }}
                onRemove={() => {
                  closeLightbox();
                  removeImage(index);
                }}
                onShowHistory={() => setIsHistoryDrawerOpen(true)}
              />
            )}
            renderItem={({ item, index }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item}
                alt={`Product image ${index + 1}`}
                draggable={false}
                onLoad={(event) => rememberAspectRatio(item, event.currentTarget)}
                className="h-full w-full object-contain"
              />
            )}
          />
        )}

        {lightboxIndex !== null && imagesPreviews[lightboxActiveIndex] ? (
          <ProductImageHistoryDrawer
            open={isHistoryDrawerOpen}
            currentUrl={imagesPreviews[lightboxActiveIndex]}
            history={findProductImageHistory(imageHistory, imagesPreviews[lightboxActiveIndex])}
            onOpenChange={setIsHistoryDrawerOpen}
            onSelect={(versionUrl) => selectImageVersion(lightboxActiveIndex, versionUrl)}
            onDelete={(versionId) => deleteImageVersion(lightboxActiveIndex, versionId)}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/**
 * One tooltip'd icon button — the whole media zone speaks the same language.
 * `surface` picks between the tile overlay (tiny, glassy chip) and the
 * lightbox toolbar (roomier, already sitting on its own glass pill).
 */
function TileActionButton({
  label,
  onClick,
  disabled,
  className,
  surface = "tile",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  surface?: "tile" | "toolbar";
  children: ReactNode;
}) {
  const isToolbar = surface === "toolbar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={isToolbar ? "ghost" : "tertiary"}
            size={isToolbar ? "icon" : "icon-sm"}
            className={cn(
              "backdrop-blur-sm text-muted-foreground hover:text-foreground",
              isToolbar ? "rounded-full" : "rounded-md size-7",
              className,
            )}
            onClick={onClick}
            disabled={disabled}
            // Kept alongside the tooltip: the native title still serves
            // assistive tech and touch users who never hover.
            title={label}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Icon-only provenance marker on a tile. The label lives in the tooltip: at
 * thumbnail size a worded badge covers a third of the photo, and these read as
 * a glanceable state rather than as text to be read every time.
 */
function TileBadgeWithTooltip({
  label,
  variant,
  children,
}: {
  label: string;
  variant: ComponentProps<typeof Badge>["variant"];
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={variant}
            // Not a control: focusable so keyboards reach the tooltip, but it
            // does nothing on click.
            tabIndex={0}
            aria-label={label}
            title={label}
            className="size-6 justify-center p-0 shadow-xs backdrop-blur-sm"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface ProductImageLightboxToolbarProps {
  preview: string;
  imageEnhance: ProductImageEnhanceControls;
  canRecrop: boolean;
  enhanceLabel: string;
  removeBackgroundLabel: string;
  historyLabel: string;
  onEnhance: () => void;
  onRemoveBackground: () => void;
  onRecrop: () => void;
  onRemove: () => void;
  onShowHistory: () => void;
}

/**
 * The tile's actions, restated as a bar under the enlarged photo. Same guards
 * as the tiles — `enhanceImage` / `removeBackground` carry the promo teaser and
 * the affordability check themselves, so there is no second copy of that logic.
 */
function ProductImageLightboxToolbar({
  preview,
  imageEnhance,
  canRecrop,
  enhanceLabel,
  removeBackgroundLabel,
  historyLabel,
  onEnhance,
  onRemoveBackground,
  onRecrop,
  onRemove,
  onShowHistory,
}: ProductImageLightboxToolbarProps) {
  const t = useTranslations("dashboard.products.form");
  const status = imageEnhance.statusByImage[preview] ?? "idle";
  const canEnhance = canApplyProductImageOperation(preview, "enhance");
  const canRemoveBackground = canApplyProductImageOperation(preview, "remove-background");

  const shell =
    "flex items-center gap-0.5 rounded-full border bg-background/72 p-1 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/60";

  // This very photo is being generated: show where it is and how to stop it,
  // rather than five buttons the merchant cannot press.
  if (status === "enhancing") {
    return (
      <div className={shell}>
        <ProductImageAiInlineStatus
          operation={imageEnhance.operationByImage[preview] ?? "enhance"}
          onCancel={imageEnhance.isCancelling ? undefined : imageEnhance.cancelRun}
          cancelLabel={t("aiCancelGeneration")}
        />
      </div>
    );
  }

  // Claimed by the running batch but not started: say so rather than showing
  // buttons that look merely disabled.
  if (status === "queued") {
    return (
      <div className={shell}>
        <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-xs font-medium whitespace-nowrap">
          <Clock className="size-3" />
          {t("aiEnhanceQueuedBadge")}
        </span>
      </div>
    );
  }

  // Another photo is busy: the queue is sequential, so these would 400 anyway.
  const isQueueBusy = imageEnhance.isRunning;

  return (
    <div className={shell}>
      <TileActionButton
        surface="toolbar"
        label={enhanceLabel}
        onClick={onEnhance}
        disabled={isQueueBusy || !canEnhance}
        className="hover:text-primary"
      >
        <WandSparkles className="size-4" />
      </TileActionButton>

      {imageEnhance.backgroundRemovalEnabled && (
        <TileActionButton
          surface="toolbar"
          label={removeBackgroundLabel}
          onClick={onRemoveBackground}
          disabled={isQueueBusy || !canRemoveBackground}
          className="hover:text-primary"
        >
          <Eraser className="size-4" />
        </TileActionButton>
      )}

      {canRecrop && (
        <TileActionButton surface="toolbar" label={t("recropImage")} onClick={onRecrop}>
          <Crop className="size-4" />
        </TileActionButton>
      )}

      <TileActionButton
        surface="toolbar"
        label={historyLabel}
        onClick={onShowHistory}
        className="hover:text-primary"
      >
        <History className="size-4" />
      </TileActionButton>

      <TileActionButton
        surface="toolbar"
        label={t("removeImage")}
        onClick={onRemove}
        className="hover:text-destructive"
      >
        <X className="size-4" />
      </TileActionButton>
    </div>
  );
}

function ProductVideoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("dashboard.products.form");
  const tCommon = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const videoId = value ? extractYouTubeVideoId(value) : null;
  const trimmedDraft = draft.trim();
  const draftVideoId = trimmedDraft ? extractYouTubeVideoId(trimmedDraft) : null;
  const isDraftInvalid = trimmedDraft.length > 0 && !draftVideoId;

  const openDialog = () => {
    setDraft(value);
    setDialogOpen(true);
  };

  const saveDraft = () => {
    onChange(trimmedDraft);
    setDialogOpen(false);
  };

  return (
    <>
      {value ? (
        <div className="group/video bg-muted/20 relative aspect-4/3 w-full max-w-48 overflow-hidden rounded-lg border">
          {videoId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getYouTubeThumbnailUrl(videoId)}
              alt={t("videoUrl")}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Video className="text-muted-foreground size-6" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
              <Play className="size-4 fill-white text-white" />
            </span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b from-black/40 to-transparent opacity-0 transition-opacity group-focus-within/video:opacity-100 group-hover/video:opacity-100" />
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within/video:opacity-100 group-hover/video:opacity-100">
            <TileActionButton label={t("editVideo")} onClick={openDialog}>
              <Pencil className="size-3" />
            </TileActionButton>
            <TileActionButton
              label={t("removeVideo")}
              onClick={() => onChange("")}
              className="hover:text-destructive"
            >
              <X className="size-3" />
            </TileActionButton>
          </div>
          <Badge
            variant="expired"
            className="absolute bottom-1.5 left-1.5 h-5 gap-1 px-1.5 text-[10px] shadow-xs backdrop-blur-sm"
          >
            <VideoSolidIcon className="size-2.5" />
            YouTube
          </Badge>
        </div>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          title={t("addVideo")}
          className="group/video border-input bg-background hover:border-muted-foreground/40 hover:bg-accent/50 flex aspect-4/3 w-full max-w-[calc(50%-6px)] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors sm:max-w-48"
        >
          <div className="bg-muted group-hover/video:bg-background group-hover/video:border-border flex size-8 items-center justify-center rounded-full border border-transparent transition-colors">
            <Video className="text-muted-foreground size-4" />
          </div>
          <span className="text-muted-foreground text-xs font-medium">{t("videoTileLabel")}</span>
        </button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("videoUrl")}</DialogTitle>
            <DialogDescription>{t("videoUrlHelp")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-3 py-1">
              <Input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("videoUrlPlaceholder")}
                aria-invalid={isDraftInvalid || undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isDraftInvalid) {
                    event.preventDefault();
                    saveDraft();
                  }
                }}
              />
              {isDraftInvalid && (
                <p className="text-destructive text-sm font-medium">{t("videoInvalid")}</p>
              )}
              {draftVideoId && (
                <div className="bg-muted relative aspect-video overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getYouTubeThumbnailUrl(draftVideoId)}
                    alt={t("videoUrl")}
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                      <Play className="size-4.5 fill-white text-white" />
                    </span>
                  </div>
                </div>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" onClick={saveDraft} disabled={isDraftInvalid}>
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
