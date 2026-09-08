"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Button, Label, Spinner, toastManager } from "@louez/ui";
import { ImageIcon, PlusIcon } from "@louez/ui/icons";
import { X } from "lucide-react";

import { ImageUploadValidationError } from "@/hooks/use-image-upload";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

import type { PendingImageUploads } from "./use-pending-image-uploads";
import { MAX_HERO_IMAGES } from "./util.appearance-form";

interface HeroImagesFieldProps {
  value: string[];
  /** The saved images: never deleted from storage before the form is saved. */
  savedValue: string[];
  uploads: PendingImageUploads;
  onChange: (next: string[]) => void;
}

/** Up to five photos as a grid of tiles; the first one is the one the page loads first. */
export const HeroImagesField = ({ value, savedValue, uploads, onChange }: HeroImagesFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const tErrors = useTranslations("errors");
  const [isUploading, setIsUploading] = useState(false);
  const canAdd = value.length < MAX_HERO_IMAGES && !isUploading;

  const handleFiles = async (fileList: FileList | null) => {
    const files = [...(fileList ?? [])].slice(0, MAX_HERO_IMAGES - value.length);
    if (files.length === 0) return;

    setIsUploading(true);
    const results = await Promise.all(
      files.map((file) =>
        uploads.upload("hero", file).catch((error: unknown) => {
          toastManager.add({
            title:
              error instanceof ImageUploadValidationError
                ? error.issue === "tooLarge"
                  ? t("fileTooLarge")
                  : t("fileNotImage")
                : tErrors("generic"),
            type: "error",
          });
          return null;
        }),
      ),
    );
    setIsUploading(false);

    const urls = results.filter((url): url is string => url !== null);
    if (urls.length > 0) onChange([...value, ...urls]);
  };

  const remove = (image: string) => {
    if (!savedValue.includes(image)) uploads.discard(image);
    onChange(value.filter((current) => current !== image));
  };

  const input = (
    <input
      id="hero-images-upload"
      type="file"
      accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
      multiple
      className="sr-only"
      disabled={!canAdd}
      onChange={(event) => {
        void handleFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label htmlFor="hero-images-upload">{t("heroImages")}</Label>
        <p className="text-muted-foreground text-xs">{t("heroImagesDescription")}</p>
      </div>

      {value.length === 0 && !isUploading ? (
        <label
          htmlFor="hero-images-upload"
          className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
          <span className="font-medium text-sm">{t("addHeroImages")}</span>
          <span className="text-muted-foreground text-xs">{t("heroImagesHint")}</span>
          {input}
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {value.map((image, index) => (
            <div
              key={image}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border"
            >
              <img src={image} alt="" className="h-full w-full object-cover" />
              {index === 0 ? (
                <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1.5 py-0.5 font-medium text-[10px]">
                  {t("heroImagesFirst")}
                </span>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                aria-label={t("removeImage")}
                className="absolute top-1 right-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => remove(image)}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          {isUploading ? (
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-primary/50 bg-primary/5">
              <Spinner className="size-5 text-primary" />
            </div>
          ) : null}
          {canAdd ? (
            <label
              htmlFor="hero-images-upload"
              className="flex aspect-[4/3] cursor-pointer items-center justify-center rounded-lg border border-dashed transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <PlusIcon aria-hidden className="size-4 text-muted-foreground" />
              <span className="sr-only">{t("addHeroImages")}</span>
              {input}
            </label>
          ) : null}
        </div>
      )}
      <p className="text-muted-foreground text-xs">{t("heroImagesHint")}</p>
    </div>
  );
};
