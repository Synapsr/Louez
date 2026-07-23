"use client";

import { useCallback } from "react";

import { useFiles } from "files-sdk/react";

import {
  type ImageUploadIssue,
  type ImageUploadKind,
  getImageKeyFromUrl,
  getImageUploadIssue,
} from "@/lib/uploads/image-upload";

export class ImageUploadValidationError extends Error {
  constructor(readonly issue: ImageUploadIssue) {
    super(issue);
    this.name = "ImageUploadValidationError";
  }
}

export const useImageUpload = (kind: ImageUploadKind) => {
  const files = useFiles({ endpoint: `/api/files/${kind}` });

  const uploadImage = useCallback(
    async (file: File) => {
      const issue = getImageUploadIssue(file, kind);
      if (issue) {
        throw new ImageUploadValidationError(issue);
      }

      const uploaded = await files.upload(file, { contentType: file.type });
      const url = await files.url(uploaded.key);

      return {
        key: uploaded.key,
        url,
        size: uploaded.size,
        contentType: uploaded.type,
      };
    },
    [files, kind],
  );

  const deleteImage = useCallback(
    async (keyOrUrl: string | null | undefined) => {
      if (!keyOrUrl) return;

      const key =
        keyOrUrl.includes("://") || keyOrUrl.startsWith("/")
          ? getImageKeyFromUrl(keyOrUrl)
          : keyOrUrl;
      if (!key) return;

      await files.delete(key);
    },
    [files],
  );

  return {
    uploadImage,
    deleteImage,
    isUploading: files.isUploading,
    progress: files.progress,
    abort: files.abort,
    reset: files.reset,
  };
};
