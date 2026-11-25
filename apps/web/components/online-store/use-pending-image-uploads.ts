"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useFiles } from "files-sdk/react";

import { MAX_HERO_VIDEO_SIZE } from "@louez/validations";
import { useImageUpload } from "@/hooks/use-image-upload";
import { getImageKeyFromUrl } from "@/lib/uploads/image-upload";

export type OnlineStoreImageKind = "logo" | "hero";

/**
 * Uploads of the online store editor that are not saved yet. Every upload is
 * tracked until the form is saved (`settle`) so an abandoned page, a reset
 * or a replaced asset deletes the orphan file from storage.
 */
export const usePendingImageUploads = () => {
  const logoFiles = useImageUpload("logo");
  const heroFiles = useImageUpload("hero");
  const videoFiles = useFiles({ endpoint: "/api/files/hero-video" });
  const pendingRef = useRef(new Map<string, OnlineStoreImageKind | "hero-video">());
  const [inFlight, setInFlight] = useState(0);
  const deleteRef = useRef({
    logo: logoFiles.deleteImage,
    hero: heroFiles.deleteImage,
    video: async (url: string) => {
      const key = getImageKeyFromUrl(url);
      if (key) await videoFiles.delete(key);
    },
  });

  useEffect(() => {
    deleteRef.current = {
      logo: logoFiles.deleteImage,
      hero: heroFiles.deleteImage,
      video: async (url: string) => {
        const key = getImageKeyFromUrl(url);
        if (key) await videoFiles.delete(key);
      },
    };
  }, [heroFiles.deleteImage, logoFiles.deleteImage, videoFiles]);

  useEffect(
    () => () => {
      void Promise.allSettled(
        [...pendingRef.current].map(([url, kind]) =>
          kind === "hero-video" ? deleteRef.current.video(url) : deleteRef.current[kind](url),
        ),
      );
    },
    [],
  );

  const uploadHeroVideo = useCallback(
    async (file: File): Promise<string> => {
      if (file.type !== "video/mp4" || !file.name.toLowerCase().endsWith(".mp4")) {
        throw new Error("videoNotMp4");
      }
      if (file.size > MAX_HERO_VIDEO_SIZE) throw new Error("videoTooLarge");
      setInFlight((count) => count + 1);
      try {
        const uploaded = await videoFiles.upload(file, { contentType: "video/mp4" });
        const url = await videoFiles.url(uploaded.key);
        pendingRef.current.set(url, "hero-video");
        return url;
      } finally {
        setInFlight((count) => count - 1);
      }
    },
    [videoFiles],
  );

  const upload = useCallback(
    async (kind: OnlineStoreImageKind, file: File): Promise<string> => {
      setInFlight((count) => count + 1);
      try {
        const uploaded = await (kind === "logo" ? logoFiles : heroFiles).uploadImage(file);
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
    void (kind === "hero-video" ? deleteRef.current.video(url) : deleteRef.current[kind](url)).catch(
      () => undefined,
    );
  }, []);

  /** After a save: pending uploads are now owned by the store; delete the images it dropped. */
  const settle = useCallback((replaced: { logos: string[]; heroes: string[]; videos: string[] }) => {
    pendingRef.current.clear();
    void Promise.allSettled([
      ...replaced.logos.map((url) => deleteRef.current.logo(url)),
      ...replaced.heroes.map((url) => deleteRef.current.hero(url)),
      ...replaced.videos.map((url) => deleteRef.current.video(url)),
    ]);
  }, []);

  return { upload, uploadHeroVideo, discard, settle, isUploading: inFlight > 0 };
};

export type PendingImageUploads = ReturnType<typeof usePendingImageUploads>;
