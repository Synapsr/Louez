"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { ImageUploadValidationError } from "@/hooks/use-image-upload";

import type { AppearanceImageKind, PendingImageUploads } from "./use-pending-image-uploads";

interface UseImageFieldUploadInput {
  kind: AppearanceImageKind;
  uploads: PendingImageUploads;
  value: string | null;
  /** The saved value: never deleted from storage before the form is saved. */
  savedValue: string | null;
  onChange: (next: string | null) => void;
}

/**
 * One image field (a logo): shows the picked file at once through an
 * object URL, swaps it for the uploaded URL, and puts the previous value
 * back when the upload fails.
 */
export const useImageFieldUpload = ({
  kind,
  uploads,
  value,
  savedValue,
  onChange,
}: UseImageFieldUploadInput) => {
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const tErrors = useTranslations("errors");
  const [isUploading, setIsUploading] = useState(false);

  const select = async (file: File) => {
    const previous = value;
    const previewUrl = URL.createObjectURL(file);
    onChange(previewUrl);
    setIsUploading(true);

    try {
      const url = await uploads.upload(kind, file);
      onChange(url);
      if (previous && previous !== savedValue) {
        uploads.discard(previous);
      }
    } catch (error) {
      toastManager.add({
        title:
          error instanceof ImageUploadValidationError
            ? error.issue === "tooLarge"
              ? t("fileTooLarge")
              : t("fileNotImage")
            : tErrors("generic"),
        type: "error",
      });
      onChange(previous);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsUploading(false);
    }
  };

  const remove = () => {
    if (value && value !== savedValue) {
      uploads.discard(value);
    }
    onChange(null);
  };

  return { isUploading, select, remove };
};
