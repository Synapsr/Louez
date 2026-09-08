"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useImageUpload } from "@/hooks/use-image-upload";

export type AppearanceImageKind = "logo" | "hero";

/**
 * Uploads of the appearance form that are not saved yet. Every upload is
 * tracked until the form is saved (`settle`) so an abandoned page, a reset
 * or a replaced image deletes the orphan file from storage.
 */
export const usePendingImageUploads = () => {
  const logoFiles = useImageUpload("logo");
  const heroFiles = useImageUpload("hero");
  const pendingRef = useRef(new Map<string, AppearanceImageKind>());
  const [inFlight, setInFlight] = useState(0);
  const deleteRef = useRef({ logo: logoFiles.deleteImage, hero: heroFiles.deleteImage });

  useEffect(() => {
    deleteRef.current = { logo: logoFiles.deleteImage, hero: heroFiles.deleteImage };
  }, [heroFiles.deleteImage, logoFiles.deleteImage]);

  useEffect(
    () => () => {
      void Promise.allSettled(
        [...pendingRef.current].map(([url, kind]) => deleteRef.current[kind](url)),
      );
    },
    [],
  );

  const upload = useCallback(
    async (kind: AppearanceImageKind, file: File): Promise<string> => {
      const files = kind === "logo" ? logoFiles : heroFiles;
      setInFlight((count) => count + 1);
      try {
        const uploaded = await files.uploadImage(file);
        pendingRef.current.set(uploaded.url, kind);
        return uploaded.url;
      } finally {
        setInFlight((count) => count - 1);
      }
    },
    [heroFiles, logoFiles],
  );

  /** Deletes the file behind `url` if it is a pending upload; saved images are left alone. */
  const discard = useCallback((url: string | null | undefined) => {
    if (!url) return;
    const kind = pendingRef.current.get(url);
    if (!kind) return;

    pendingRef.current.delete(url);
    void deleteRef.current[kind](url).catch(() => undefined);
  }, []);

  /** After a save: pending uploads are now owned by the store; delete the images it dropped. */
  const settle = useCallback((replaced: { logos: string[]; heroes: string[] }) => {
    pendingRef.current.clear();
    void Promise.allSettled([
      ...replaced.logos.map((url) => deleteRef.current.logo(url)),
      ...replaced.heroes.map((url) => deleteRef.current.hero(url)),
    ]);
  }, []);

  return { upload, discard, settle, isUploading: inFlight > 0 };
};

export type PendingImageUploads = ReturnType<typeof usePendingImageUploads>;
