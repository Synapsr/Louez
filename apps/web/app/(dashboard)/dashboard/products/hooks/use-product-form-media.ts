import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { useTranslations } from "next-intl";

import type { ProductImageHistory, ProductImageVersionKind } from "@louez/types";
import { toastManager } from "@louez/ui";

import { useImageUpload } from "@/hooks/use-image-upload";
import { getImageUploadIssue } from "@/lib/uploads/image-upload";

import type { ProductFormComponentApi } from "../types";
import {
  createMaxCenteredAspectCropPercent,
  createCroppedDataUrl,
  getCropSizePercentFromRect,
  getImageSizeFromSource,
  getPixelCropFromPercentRect,
  isCropSupportedMime,
  type ProductImagePercentCropRect,
  type ProductImagePixelCropRect,
  type ProductImageSize,
  readFileAsDataUrl,
} from "../utils/product-image-crop";
import {
  addProductImageHistory,
  appendProductImageVersion,
  collectProductImageUrls,
  findProductImageHistory,
  removeProductImageHistory,
  removeProductImageVersion,
} from "../utils/util.product-image-history";
import {
  useProductImageEnhance,
  type ProductImageOperation,
  type ProductImageOperationTarget,
} from "./use-product-image-enhance";

interface UseProductFormMediaParams {
  form: ProductFormComponentApi;
  productId?: string;
  imagesPreviews: string[];
  imageHistory: ProductImageHistory[];
  imageEnhanceEnabled?: boolean;
  imageBackgroundRemovalEnabled?: boolean;
}

const MAX_PRODUCT_IMAGES = 5;

interface PreparedUploadImage {
  id: string;
  order: number;
  dataUrl: string;
  /** Existing version this upload derives from (recrop). */
  sourceUrl?: string;
  /** Fresh source bytes to persist before the transformed active version. */
  sourceDataUrl?: string;
  versionKind?: ProductImageVersionKind;
}

/** Links a queue item back to the object it produced once uploaded. */
interface UploadedImageResult {
  id: string;
  url: string;
}

type CropSessionMode = "append" | "replace";

/**
 * An AI run launched from the crop dialog. It only mirrors what the dialog has
 * to render — the processing itself lives in `useProductImageEnhance`, so
 * closing the dialog (which drops this object) never interrupts the queue.
 */
export interface ProductImageCropAiSession {
  targets: ProductImageOperationTarget[];
  /** Preview shown while the queue runs — the uploaded object of the 1st target. */
  previewUrl: string;
  /** Drives the step labels; a mixed session reports its dominant operation. */
  operation: ProductImageOperation;
  status: "processing" | "review" | "failed" | "cancelled";
}

export interface ProductImageCropQueueItem {
  id: string;
  order: number;
  mimeType: string;
  originalDataUrl: string;
  imageSize: ProductImageSize;
  crop: ProductImagePercentCropRect;
  cropSizePercent: number;
  croppedAreaPixels: ProductImagePixelCropRect | null;
  resultMode: "cropped" | "original";
  /** Present for a recrop so the new file joins the existing lineage. */
  sourceUrl?: string;
}

function createCandidateId(index: number) {
  return `product-image-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

// Decode locally: fetch(dataUrl) is blocked by connect-src in production and
// can also be intercepted by third-party network instrumentation.
const dataUrlToFile = (dataUrl: string, filename: string) => {
  const [header = "", payload = ""] = dataUrl.split(",");
  const mimeType = header.match(/^data:([^;,]+)/)?.[1] || "image/jpeg";

  let bytes: Uint8Array<ArrayBuffer>;
  if (header.includes(";base64")) {
    const binary = atob(payload);
    bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } else {
    const encoded = new TextEncoder().encode(decodeURIComponent(payload));
    bytes = new Uint8Array(new ArrayBuffer(encoded.length));
    bytes.set(encoded);
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "");
  return new File([bytes], `${filename}.${extension}`, { type: mimeType });
};

export function useProductFormMedia({
  form,
  productId,
  imagesPreviews,
  imageHistory,
  imageEnhanceEnabled = false,
  imageBackgroundRemovalEnabled = false,
}: UseProductFormMediaParams) {
  const t = useTranslations("dashboard.products.form");
  const { uploadImage, deleteImage } = useImageUpload("product");
  // Uploads not saved yet. They are deleted only when the merchant drops them
  // from the form, never on unmount: with Cache Components, leaving the page
  // hides it in an <Activity> boundary, which runs effect cleanups but keeps
  // the form state. Deleting there removed files the form still showed and
  // later saved (Gleap #847). A form that is really abandoned leaves orphans.
  const pendingUploadsRef = useRef(new Set<string>());
  const imageHistoryRef = useRef(imageHistory);

  // Objects already stored by a batch that has not handed them to the form yet.
  // A multi-image batch uploads sequentially and the SDK re-renders on upload
  // progress, so between two files the reconciliation effect below would see an
  // object the form knows nothing about — and delete what was just stored.
  const inFlightUploadsRef = useRef(new Set<string>());

  useEffect(() => {
    imageHistoryRef.current = imageHistory;
  }, [imageHistory]);

  const setImageHistory = useCallback(
    (nextHistory: ProductImageHistory[]) => {
      imageHistoryRef.current = nextHistory;
      form.setFieldValue("imageHistory", nextHistory);
    },
    [form],
  );

  useEffect(() => {
    const retainedUrls = new Set(collectProductImageUrls(imagesPreviews, imageHistory));
    for (const url of pendingUploadsRef.current) {
      // Not yet reconcilable: the form has not been told about it.
      if (inFlightUploadsRef.current.has(url)) continue;
      if (!retainedUrls.has(url)) {
        pendingUploadsRef.current.delete(url);
        void deleteImage(url).catch(() => undefined);
      }
    }
  }, [deleteImage, imageHistory, imagesPreviews]);

  const [isDragging, setIsDragging] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [isPreparingCrop, setIsPreparingCrop] = useState(false);
  const [isUploadingToServer, setIsUploadingToServer] = useState(false);
  const recropAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const controller = recropAbortControllerRef.current;
      recropAbortControllerRef.current = null;
      controller?.abort();
    },
    [],
  );

  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [selectedCropIndex, setSelectedCropIndex] = useState(0);
  const [cropQueueItems, setCropQueueItems] = useState<ProductImageCropQueueItem[]>([]);
  const [passthroughQueueItems, setPassthroughQueueItems] = useState<PreparedUploadImage[]>([]);
  const [cropSessionMode, setCropSessionMode] = useState<CropSessionMode>("append");
  const [replaceImageIndex, setReplaceImageIndex] = useState<number | null>(null);

  // Crop queue item ids the user sent to the AI from the crop dialog, with the
  // operation each one asked for. The processing can only run on an uploaded
  // object, so the flags are resolved to their uploaded URLs once the session
  // upload succeeds.
  const pendingCropOperationsRef = useRef(new Map<string, ProductImageOperation>());

  // Set when the crop dialog hands a batch over to the AI: the dialog then
  // stays open on its processing/review views instead of closing.
  const [cropAiSession, setCropAiSession] = useState<ProductImageCropAiSession | null>(null);

  const isUploadingImages = isPreparingSession || isUploadingToServer;

  const currentCropItem = useMemo(
    () => cropQueueItems[selectedCropIndex] ?? null,
    [cropQueueItems, selectedCropIndex],
  );

  const canGoToPreviousCropItem = selectedCropIndex > 0;
  const canGoToNextCropItem = selectedCropIndex < cropQueueItems.length - 1;

  // `keepDialogOpen` hands the dialog over to an AI session: the crop queue is
  // consumed (uploaded) but the modal must stay up to show the processing.
  const resetCropSession = useCallback((options?: { keepDialogOpen?: boolean }) => {
    if (!options?.keepDialogOpen) {
      setIsCropDialogOpen(false);
      setCropAiSession(null);
    }
    setSelectedCropIndex(0);
    setCropQueueItems([]);
    setPassthroughQueueItems([]);
    setCropSessionMode("append");
    setReplaceImageIndex(null);
    pendingCropOperationsRef.current.clear();
  }, []);

  const uploadPreparedImages = useCallback(
    async (
      preparedImages: PreparedUploadImage[],
      options?: { mode?: CropSessionMode; replaceIndex?: number | null },
    ): Promise<UploadedImageResult[]> => {
      if (preparedImages.length === 0) return [];

      setIsUploadingToServer(true);
      const uploadedUrls: {
        id: string;
        order: number;
        url: string;
        sourceUrl?: string;
        versionKind: ProductImageVersionKind;
      }[] = [];
      const storedUrls: string[] = [];

      try {
        for (let index = 0; index < preparedImages.length; index += 1) {
          const prepared = preparedImages[index];

          let historySourceUrl = prepared.sourceUrl;
          if (prepared.sourceDataUrl) {
            const sourceFile = dataUrlToFile(
              prepared.sourceDataUrl,
              `product-${Date.now()}-${prepared.order}-original`,
            );
            const sourceUpload = await uploadImage(sourceFile);
            historySourceUrl = sourceUpload.url;
            storedUrls.push(sourceUpload.url);
            pendingUploadsRef.current.add(sourceUpload.url);
            inFlightUploadsRef.current.add(sourceUpload.url);
          }

          const file = dataUrlToFile(prepared.dataUrl, `product-${Date.now()}-${prepared.order}`);
          const uploaded = await uploadImage(file);
          pendingUploadsRef.current.add(uploaded.url);
          // Shielded from the reconciliation effect until the whole batch is
          // handed to the form, a few lines below.
          inFlightUploadsRef.current.add(uploaded.url);
          storedUrls.push(uploaded.url);
          uploadedUrls.push({
            id: prepared.id,
            order: prepared.order,
            url: uploaded.url,
            sourceUrl: historySourceUrl,
            versionKind: prepared.versionKind ?? "original",
          });
        }

        if (uploadedUrls.length > 0) {
          const orderedUploads = [...uploadedUrls].sort((a, b) => a.order - b.order);
          const orderedUploadedUrls = orderedUploads.map((item) => item.url);
          let nextImageHistory = imageHistoryRef.current;

          for (const uploaded of orderedUploads) {
            if (uploaded.sourceUrl) {
              nextImageHistory = addProductImageHistory(nextImageHistory, uploaded.sourceUrl);
              nextImageHistory = appendProductImageVersion(
                nextImageHistory,
                uploaded.sourceUrl,
                uploaded.url,
                uploaded.versionKind,
              );
            } else {
              nextImageHistory = addProductImageHistory(nextImageHistory, uploaded.url);
            }
          }

          if (
            options?.mode === "replace" &&
            options.replaceIndex != null &&
            options.replaceIndex >= 0 &&
            options.replaceIndex < imagesPreviews.length
          ) {
            const updatedImages = [...imagesPreviews];
            updatedImages.splice(
              options.replaceIndex,
              Math.max(1, orderedUploadedUrls.length),
              ...orderedUploadedUrls,
            );
            form.setFieldValue("images", updatedImages);
          } else {
            form.setFieldValue("images", [...imagesPreviews, ...orderedUploadedUrls]);
          }
          setImageHistory(nextImageHistory);
        }

        return uploadedUrls.map(({ id, url }) => ({ id, url }));
      } catch (error) {
        for (const url of storedUrls) {
          pendingUploadsRef.current.delete(url);
        }
        void Promise.allSettled(storedUrls.map((url) => deleteImage(url)));
        console.error("Image upload error:", error);
        toastManager.add({ title: t("imageUploadError"), type: "error" });
        return [];
      } finally {
        // Cleared after `setFieldValue` but before React re-renders, so the
        // next reconciliation already sees these URLs in the form.
        for (const url of storedUrls) {
          inFlightUploadsRef.current.delete(url);
        }
        setIsUploadingToServer(false);
      }
    },
    [deleteImage, form, imagesPreviews, setImageHistory, t, uploadImage],
  );

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const remainingSlots = Math.max(0, MAX_PRODUCT_IMAGES - imagesPreviews.length);
      const filesToProcess = fileArray.slice(0, remainingSlots);

      if (filesToProcess.length === 0) return;

      setIsPreparingSession(true);

      const nextCropQueueItems: ProductImageCropQueueItem[] = [];
      const nextPassthroughItems: PreparedUploadImage[] = [];

      try {
        for (let index = 0; index < filesToProcess.length; index += 1) {
          const file = filesToProcess[index];

          const issue = getImageUploadIssue(file, "product");
          if (issue) {
            toastManager.add({
              title: issue === "tooLarge" ? t("imageSizeError") : t("imageError"),
              type: "error",
            });
            continue;
          }

          const candidateId = createCandidateId(index);
          const dataUrl = await readFileAsDataUrl(file);
          const mimeType = file.type.toLowerCase();

          if (isCropSupportedMime(mimeType)) {
            const imageSize = await getImageSizeFromSource(dataUrl);
            const initialCrop = createMaxCenteredAspectCropPercent(imageSize);
            nextCropQueueItems.push({
              id: candidateId,
              order: index,
              mimeType,
              originalDataUrl: dataUrl,
              imageSize,
              crop: initialCrop,
              cropSizePercent: 100,
              croppedAreaPixels: getPixelCropFromPercentRect(initialCrop, imageSize),
              resultMode: "original",
            });
          } else {
            nextPassthroughItems.push({
              id: candidateId,
              order: index,
              dataUrl,
            });
          }
        }

        if (nextCropQueueItems.length === 0) {
          const orderedPassthroughImages = [...nextPassthroughItems].sort(
            (a, b) => a.order - b.order,
          );
          await uploadPreparedImages(orderedPassthroughImages);
          return;
        }

        setCropQueueItems(nextCropQueueItems.sort((a, b) => a.order - b.order));
        setPassthroughQueueItems(nextPassthroughItems);
        setCropSessionMode("append");
        setReplaceImageIndex(null);
        setSelectedCropIndex(0);
        setIsCropDialogOpen(true);
      } catch (error) {
        console.error("Image processing error:", error);
        toastManager.add({ title: t("imageUploadError"), type: "error" });
      } finally {
        setIsPreparingSession(false);
      }
    },
    [imagesPreviews.length, t, uploadPreparedImages],
  );

  const handleImageUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;

      void processFiles(event.target.files);
      event.target.value = "";
    },
    [processFiles],
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        void processFiles(event.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const removeImage = useCallback(
    (index: number) => {
      const removedImage = imagesPreviews[index];
      form.setFieldValue(
        "images",
        imagesPreviews.filter((_, currentIndex) => currentIndex !== index),
      );
      if (removedImage)
        setImageHistory(removeProductImageHistory(imageHistoryRef.current, removedImage));
    },
    [form, imagesPreviews, setImageHistory],
  );

  const markUploadsPersisted = useCallback(() => {
    pendingUploadsRef.current.clear();
  }, []);

  const reorderImages = useCallback(
    (images: string[]) => {
      form.setFieldValue("images", images);
    },
    [form],
  );

  const selectImageVersion = useCallback(
    (index: number, versionUrl: string) => {
      const currentUrl = imagesPreviews[index];
      if (!currentUrl || currentUrl === versionUrl) return;

      const updated = [...imagesPreviews];
      updated[index] = versionUrl;
      form.setFieldValue("images", updated);
    },
    [form, imagesPreviews],
  );

  const deleteImageVersion = useCallback(
    (index: number, versionId: string) => {
      const currentUrl = imagesPreviews[index];
      if (!currentUrl) return;

      const history = findProductImageHistory(imageHistoryRef.current, currentUrl);
      if (!history || history.versions.length <= 1) return;

      const version = history.versions.find(({ id }) => id === versionId);
      if (!version) return;

      const remainingVersions = history.versions.filter(({ id }) => id !== versionId);
      const nextHistory = removeProductImageVersion(imageHistoryRef.current, history.id, versionId);

      if (version.url === currentUrl) {
        const fallback = remainingVersions.at(-1);
        if (!fallback) return;

        const updated = [...imagesPreviews];
        updated[index] = fallback.url;
        form.setFieldValue("images", updated);
      }

      setImageHistory(nextHistory);
    },
    [form, imagesPreviews, setImageHistory],
  );

  // Swaps an accepted AI result in place and appends it to the logical photo's
  // non-destructive lineage. The original remains referenced by imageHistory.
  const replaceImageWithEnhanced = useCallback(
    (originalUrl: string, enhancedUrl: string, operation: ProductImageOperation) => {
      const index = imagesPreviews.indexOf(originalUrl);
      if (index === -1) return false;

      pendingUploadsRef.current.add(enhancedUrl);
      setImageHistory(
        appendProductImageVersion(
          imageHistoryRef.current,
          originalUrl,
          enhancedUrl,
          operation === "enhance" ? "ai-enhanced" : "background-removed",
        ),
      );
      const updated = [...imagesPreviews];
      updated[index] = enhancedUrl;
      form.setFieldValue("images", updated);
      return true;
    },
    [form, imagesPreviews, setImageHistory],
  );

  const keepGeneratedImageInHistory = useCallback(
    (originalUrl: string, enhancedUrl: string, operation: ProductImageOperation) => {
      const belongsToPhoto =
        imagesPreviews.includes(originalUrl) ||
        findProductImageHistory(imageHistoryRef.current, originalUrl) !== null;
      if (!belongsToPhoto) return false;

      pendingUploadsRef.current.add(enhancedUrl);
      setImageHistory(
        appendProductImageVersion(
          imageHistoryRef.current,
          originalUrl,
          enhancedUrl,
          operation === "enhance" ? "ai-enhanced" : "background-removed",
        ),
      );
      return true;
    },
    [imagesPreviews, setImageHistory],
  );

  const {
    imageEnhance,
    processImages,
    enhanceReviewItems,
    isEnhanceReviewOpen,
    acceptEnhancedImage,
    rejectEnhancedImage,
    closeEnhanceReview,
    isEnhancePromoOpen,
    enhancePromoReason,
    openEnhancePromo,
    closeEnhancePromo,
  } = useProductImageEnhance({
    enabled: imageEnhanceEnabled,
    backgroundRemovalEnabled: imageBackgroundRemovalEnabled,
    productId,
    imagesPreviews,
    replaceImage: replaceImageWithEnhanced,
    keepGeneratedImage: keepGeneratedImageInHistory,
  });

  const setCropRect = useCallback((itemId: string, crop: ProductImagePercentCropRect) => {
    setCropQueueItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;

        return {
          ...item,
          crop,
          cropSizePercent: getCropSizePercentFromRect(crop, item.imageSize),
        };
      }),
    );
  }, []);

  const setCropSizePercent = useCallback((itemId: string, cropSizePercent: number) => {
    setCropQueueItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, cropSizePercent } : item)),
    );
  }, []);

  const setCropAreaPixels = useCallback(
    (itemId: string, croppedAreaPixels: ProductImagePixelCropRect) => {
      setCropQueueItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                croppedAreaPixels,
              }
            : item,
        ),
      );
    },
    [],
  );

  const goToPreviousCropItem = useCallback(() => {
    if (!canGoToPreviousCropItem) return;
    setSelectedCropIndex((prev) => prev - 1);
  }, [canGoToPreviousCropItem]);

  const goToNextCropItem = useCallback(() => {
    if (!canGoToNextCropItem) return;
    setSelectedCropIndex((prev) => prev + 1);
  }, [canGoToNextCropItem]);

  // Dropping the session only drops the dialog's view of it: the queue in
  // `useProductImageEnhance` keeps running and its results land on the tiles.
  const closeCropDialog = useCallback(() => {
    if (isUploadingToServer) return;
    recropAbortControllerRef.current?.abort();
    recropAbortControllerRef.current = null;
    setIsPreparingCrop(false);
    resetCropSession();
  }, [isUploadingToServer, resetCropSession]);

  const runCropAiSession = useCallback(
    (targets: ProductImageOperationTarget[]) => {
      void processImages(targets).then((outcome) => {
        setCropAiSession((prev) => {
          if (!prev) return prev;
          // Anything that came back still deserves a review, even if the
          // merchant stopped the batch half-way through.
          if (outcome.produced > 0) return { ...prev, status: "review" };
          return { ...prev, status: outcome.cancelled ? "cancelled" : "failed" };
        });
      });
    },
    [processImages],
  );

  // Kept out of the state updater: React may re-run one, and that would fire a
  // second (billable) round of requests.
  const retryCropAiSession = useCallback(() => {
    if (!cropAiSession) return;
    setCropAiSession({ ...cropAiSession, status: "processing" });
    runCropAiSession(cropAiSession.targets);
  }, [cropAiSession, runCropAiSession]);

  /**
   * Accept/reject from inside the crop dialog. The staging lives in the enhance
   * hook; closing is left to the effect below, which is the only place that
   * knows whether the queue still has photos to deliver.
   */
  const resolveCropAiReviewItem = useCallback(
    (itemId: string, decision: "accept" | "reject") => {
      if (decision === "accept") acceptEnhancedImage(itemId);
      else rejectEnhancedImage(itemId);
    },
    [acceptEnhancedImage, rejectEnhancedImage],
  );

  // Results are reviewable as they land, so "nothing left to review" is not the
  // end of the session — the run has to be over too. Resolving the last item
  // mid-run falls back to the progress view until the next one is ready.
  useEffect(() => {
    if (cropAiSession?.status !== "review") return;
    if (enhanceReviewItems.length > 0) return;
    resetCropSession();
  }, [cropAiSession?.status, enhanceReviewItems.length, resetCropSession]);

  const recropImage = useCallback(
    async (index: number) => {
      const imageUrl = imagesPreviews[index];
      if (!imageUrl) return;

      recropAbortControllerRef.current?.abort();
      const controller = new AbortController();
      recropAbortControllerRef.current = controller;

      setCropAiSession(null);
      setCropQueueItems([]);
      setPassthroughQueueItems([]);
      setCropSessionMode("replace");
      setReplaceImageIndex(index);
      setSelectedCropIndex(0);
      pendingCropOperationsRef.current.clear();
      setIsPreparingCrop(true);
      setIsCropDialogOpen(true);

      try {
        const response = await fetch("/api/files/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: imageUrl, productId }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load existing image");
        }

        const payload = (await response.json()) as {
          dataUrl?: string;
          mimeType?: string;
        };
        const dataUrl = payload.dataUrl;
        const mimeType = (payload.mimeType || "image/jpeg").toLowerCase();

        if (!dataUrl) {
          throw new Error("Missing source image data");
        }

        if (!isCropSupportedMime(mimeType)) {
          resetCropSession();
          toastManager.add({
            title: t("cropUnsupportedFormat"),
            type: "error",
          });
          return;
        }

        const imageSize = await getImageSizeFromSource(dataUrl);
        if (controller.signal.aborted) return;

        const initialCrop = createMaxCenteredAspectCropPercent(imageSize);

        setCropQueueItems([
          {
            id: createCandidateId(index),
            order: 0,
            mimeType,
            originalDataUrl: dataUrl,
            imageSize,
            crop: initialCrop,
            cropSizePercent: 100,
            croppedAreaPixels: getPixelCropFromPercentRect(initialCrop, imageSize),
            resultMode: "cropped",
            sourceUrl: imageUrl,
          },
        ]);
      } catch (error) {
        if (controller.signal.aborted) return;

        resetCropSession();
        console.error("Image recrop prepare error:", error);
        toastManager.add({ title: t("imageUploadError"), type: "error" });
      } finally {
        if (recropAbortControllerRef.current === controller) {
          recropAbortControllerRef.current = null;
          setIsPreparingCrop(false);
        }
      }
    },
    [imagesPreviews, productId, resetCropSession, t],
  );

  const uploadCropQueue = useCallback(
    async (queueItems: ProductImageCropQueueItem[]) => {
      if (queueItems.length === 0) {
        resetCropSession();
        return;
      }

      const preparedCropImages: PreparedUploadImage[] = [];

      try {
        for (const item of queueItems) {
          let preparedDataUrl = item.originalDataUrl;

          if (item.resultMode === "cropped" && item.croppedAreaPixels) {
            preparedDataUrl = await createCroppedDataUrl({
              imageSrc: item.originalDataUrl,
              croppedAreaPixels: item.croppedAreaPixels,
              mimeType: item.mimeType,
            });
          }

          preparedCropImages.push({
            id: item.id,
            order: item.order,
            dataUrl: preparedDataUrl,
            sourceUrl: item.sourceUrl,
            sourceDataUrl:
              !item.sourceUrl && item.resultMode === "cropped" ? item.originalDataUrl : undefined,
            versionKind: item.resultMode === "cropped" ? "cropped" : "original",
          });
        }

        const allPreparedImages = [...preparedCropImages, ...passthroughQueueItems].sort(
          (a, b) => a.order - b.order,
        );

        const uploadedImages = await uploadPreparedImages(allPreparedImages, {
          mode: cropSessionMode,
          replaceIndex: replaceImageIndex,
        });
        if (uploadedImages.length === 0) return;

        // Resolved before the reset clears the flags: an image can only be
        // processed once its object exists on the storage.
        const aiTargets = uploadedImages.flatMap<ProductImageOperationTarget>((uploaded) => {
          const operation = pendingCropOperationsRef.current.get(uploaded.id);
          return operation ? [{ imageUrl: uploaded.url, operation }] : [];
        });

        if (aiTargets.length === 0) {
          resetCropSession();
          return;
        }

        // Preview from the local data URL, not the uploaded object: a freshly
        // uploaded S3 object can lag behind its public-read ACL, and the local
        // bytes are on hand anyway.
        const firstAiUploadedId = uploadedImages.find((uploaded) =>
          pendingCropOperationsRef.current.has(uploaded.id),
        )?.id;
        const previewDataUrl =
          allPreparedImages.find((prepared) => prepared.id === firstAiUploadedId)?.dataUrl ??
          aiTargets[0].imageUrl;

        // The dialog survives the reset and switches to its processing view.
        resetCropSession({ keepDialogOpen: true });
        setCropAiSession({
          targets: aiTargets,
          previewUrl: previewDataUrl,
          operation: aiTargets.every((target) => target.operation === "remove-background")
            ? "remove-background"
            : "enhance",
          status: "processing",
        });
        runCropAiSession(aiTargets);
      } catch (error) {
        console.error("Image crop error:", error);
        toastManager.add({ title: t("imageUploadError"), type: "error" });
      }
    },
    [
      cropSessionMode,
      passthroughQueueItems,
      replaceImageIndex,
      resetCropSession,
      runCropAiSession,
      t,
      uploadPreparedImages,
    ],
  );

  const applyCurrentCropChoice = useCallback(
    async (
      nextResultMode: "cropped" | "original",
      options?: { aiOperation?: ProductImageOperation },
    ) => {
      const activeItem = cropQueueItems[selectedCropIndex];
      if (!activeItem) return;

      if (options?.aiOperation) {
        pendingCropOperationsRef.current.set(activeItem.id, options.aiOperation);
      } else {
        pendingCropOperationsRef.current.delete(activeItem.id);
      }

      const updatedQueue = cropQueueItems.map((item) =>
        item.id === activeItem.id
          ? {
              ...item,
              resultMode: nextResultMode,
            }
          : item,
      );

      setCropQueueItems(updatedQueue);

      if (selectedCropIndex < updatedQueue.length - 1) {
        setSelectedCropIndex((prev) => prev + 1);
        return;
      }

      await uploadCropQueue(updatedQueue);
    },
    [cropQueueItems, selectedCropIndex, uploadCropQueue],
  );

  // These return their promise rather than voiding it: the dialog awaits them
  // to know which of its buttons should carry the pending state, since the
  // `isUploadingImages` flag alone cannot say who started the upload.
  const applyCurrentCropAndProceed = useCallback(
    () => applyCurrentCropChoice("cropped"),
    [applyCurrentCropChoice],
  );

  const keepCurrentCropOriginalAndProceed = useCallback(
    () => applyCurrentCropChoice("original"),
    [applyCurrentCropChoice],
  );

  // Same as "keep the original" — the AI reframes the photo itself — plus a
  // flag so the uploaded object is sent to the processing queue afterwards.
  const startAiOnCurrentCropImage = useCallback(
    (operation: ProductImageOperation) => {
      if (operation === "enhance" && !imageEnhanceEnabled) {
        openEnhancePromo();
        return;
      }
      if (operation === "remove-background" && !imageBackgroundRemovalEnabled) return;

      // Guarded here rather than after the upload so the merchant stays on the
      // choice step while the educational recharge dialog opens above it.
      if (!imageEnhance.canAffordOperation(operation)) {
        imageEnhance.showCreditsDialog();
        return;
      }

      return applyCurrentCropChoice("original", { aiOperation: operation });
    },
    [
      applyCurrentCropChoice,
      imageBackgroundRemovalEnabled,
      imageEnhance,
      imageEnhanceEnabled,
      openEnhancePromo,
    ],
  );

  const enhanceCurrentCropImageAndProceed = useCallback(() => {
    startAiOnCurrentCropImage("enhance");
  }, [startAiOnCurrentCropImage]);

  /** "Enhance the N photos": flags the whole queue and uploads it in one go. */
  const enhanceAllCropImages = useCallback(() => {
    if (!imageEnhanceEnabled) {
      openEnhancePromo();
      return;
    }
    if (!imageEnhance.canAffordOperation("enhance")) {
      imageEnhance.showCreditsDialog();
      return;
    }

    const updatedQueue = cropQueueItems.map((item) => {
      pendingCropOperationsRef.current.set(item.id, "enhance");
      return { ...item, resultMode: "original" as const };
    });
    setCropQueueItems(updatedQueue);
    return uploadCropQueue(updatedQueue);
  }, [cropQueueItems, imageEnhance, imageEnhanceEnabled, openEnhancePromo, uploadCropQueue]);

  const replaceCurrentCropImage = useCallback(
    async (file: File) => {
      if (selectedCropIndex < 0 || selectedCropIndex >= cropQueueItems.length) {
        return;
      }

      const issue = getImageUploadIssue(file, "product");
      if (issue) {
        toastManager.add({
          title: issue === "tooLarge" ? t("imageSizeError") : t("imageError"),
          type: "error",
        });
        return;
      }

      const mimeType = file.type.toLowerCase();
      if (!isCropSupportedMime(mimeType)) {
        toastManager.add({ title: t("cropUnsupportedFormat"), type: "error" });
        return;
      }

      setIsPreparingSession(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const imageSize = await getImageSizeFromSource(dataUrl);
        const initialCrop = createMaxCenteredAspectCropPercent(imageSize);
        const initialPixels = getPixelCropFromPercentRect(initialCrop, imageSize);

        setCropQueueItems((prev) =>
          prev.map((item, index) =>
            index === selectedCropIndex
              ? {
                  ...item,
                  mimeType,
                  originalDataUrl: dataUrl,
                  imageSize,
                  crop: initialCrop,
                  cropSizePercent: 100,
                  croppedAreaPixels: initialPixels,
                  resultMode: "cropped",
                }
              : item,
          ),
        );
      } catch (error) {
        console.error("Image replace error:", error);
        toastManager.add({ title: t("imageUploadError"), type: "error" });
      } finally {
        setIsPreparingSession(false);
      }
    },
    [cropQueueItems.length, selectedCropIndex, t],
  );

  const uploadCropSession = useCallback(async () => {
    await uploadCropQueue(cropQueueItems);
  }, [cropQueueItems, uploadCropQueue]);

  return {
    isDragging,
    isUploadingImages,
    isPreparingCrop,
    isCropDialogOpen,
    cropQueueItems,
    selectedCropIndex,
    currentCropItem,
    // A recropped image is already in the form: it goes straight to the editor,
    // the intent step only makes sense for freshly uploaded photos.
    isFreshCropSession: cropSessionMode === "append",
    cropAiSession,
    retryCropAiSession,
    resolveCropAiReviewItem,
    startAiOnCurrentCropImage,
    enhanceAllCropImages,
    canGoToPreviousCropItem,
    canGoToNextCropItem,
    processFiles,
    handleImageUpload,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    removeImage,
    reorderImages,
    selectImageVersion,
    deleteImageVersion,
    recropImage,
    setSelectedCropIndex,
    setCropRect,
    setCropSizePercent,
    setCropAreaPixels,
    applyCurrentCropAndProceed,
    keepCurrentCropOriginalAndProceed,
    enhanceCurrentCropImageAndProceed,
    replaceCurrentCropImage,
    goToPreviousCropItem,
    goToNextCropItem,
    closeCropDialog,
    uploadCropSession,
    markUploadsPersisted,
    imageEnhance,
    enhanceReviewItems,
    // The crop dialog hosts the review itself while it is open — the standalone
    // review dialog only takes over once the merchant left the modal.
    isEnhanceReviewOpen: isEnhanceReviewOpen && !isCropDialogOpen,
    acceptEnhancedImage,
    rejectEnhancedImage,
    closeEnhanceReview,
    isEnhancePromoOpen,
    enhancePromoReason,
    closeEnhancePromo,
  };
}
