"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useState } from "react";

import { Crop, ImageUp, Loader2, Pencil, Play, Star, Video, X } from "lucide-react";
import { useTranslations } from "next-intl";

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
} from "@louez/ui";
import { cn } from "@louez/utils";

import { getFieldError } from "@/hooks/form/form-context";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";
import { extractYouTubeVideoId, getYouTubeThumbnailUrl } from "@/lib/youtube";

import type { ProductFormComponentApi } from "../types";

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
  setMainImage: (index: number) => void;
  recropImage: (index: number) => void;
  canRecrop: boolean;
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
  setMainImage,
  recropImage,
  canRecrop,
  showPhotosLabel = true,
}: ProductMediaFieldsProps) {
  const t = useTranslations("dashboard.products.form");

  return (
    <div className="space-y-4">
      <form.Field name="images">
        {(field) => (
          <div className="space-y-2.5">
            {showPhotosLabel && (
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">{t("photos")}</Label>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {imagesPreviews.length}/5
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {imagesPreviews.map((preview, index) => (
                <div
                  key={index}
                  className="group max-w-[calc(50%-6px)] sm:max-w-48 w-full bg-muted/20 relative aspect-4/3 overflow-hidden rounded-lg border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt={`Product image ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b from-black/40 to-transparent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {index !== 0 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="bg-background/80 hover:bg-background size-6 rounded-md shadow-xs backdrop-blur-sm"
                        onClick={() => setMainImage(index)}
                        title={t("setAsMain")}
                      >
                        <Star className="size-3" />
                      </Button>
                    )}
                    {canRecrop && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="bg-background/80 hover:bg-background size-6 rounded-md shadow-xs backdrop-blur-sm"
                        onClick={() => recropImage(index)}
                        title={t("recropImage")}
                      >
                        <Crop className="size-3" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="bg-background/80 hover:bg-background hover:text-destructive size-6 rounded-md shadow-xs backdrop-blur-sm"
                      onClick={() => removeImage(index)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                  {index === 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-background/80 text-foreground absolute bottom-1.5 left-1.5 h-5 gap-1 px-1.5 text-[10px] shadow-xs backdrop-blur-sm"
                    >
                      <Star className="size-2.5 fill-current" />
                      {t("mainBadge")}
                    </Badge>
                  )}
                </div>
              ))}

              {imagesPreviews.length < 5 && (
                <label
                  className={cn(
                    "group/add max-w-[49%] sm:max-w-48 w-full flex aspect-4/3 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors",
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
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="bg-background/80 hover:bg-background size-6 rounded-md shadow-xs backdrop-blur-sm"
              onClick={openDialog}
              title={t("editVideo")}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="bg-background/80 hover:bg-background hover:text-destructive size-6 rounded-md shadow-xs backdrop-blur-sm"
              onClick={() => onChange("")}
              title={t("removeVideo")}
            >
              <X className="size-3" />
            </Button>
          </div>
          <Badge
            variant="secondary"
            className="bg-background/80 text-foreground absolute bottom-1.5 left-1.5 h-5 gap-1 px-1.5 text-[10px] shadow-xs backdrop-blur-sm"
          >
            <Video className="size-2.5" />
            YouTube
          </Badge>
        </div>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          title={t("addVideo")}
          className="group/video border-input bg-background hover:border-muted-foreground/40 hover:bg-accent/50 flex aspect-4/3 w-full max-w-[49%] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors sm:max-w-48"
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
