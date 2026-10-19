import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { useImageUpload } from "@/hooks/use-image-upload";
import type { ProductImageFramingMode } from "@/lib/ai/image/framing";
import {
  canApplyProductImageOperation,
  getImageKeyFromUrl,
  getProductImageProcessingKind,
} from "@/lib/uploads/image-upload";
import { aiCreditsQueries } from "@/lib/queries/ai-credits.queries";

const ENHANCE_ENDPOINT = "/api/ai/product-image/enhance";

export type ProductImageOperation = "enhance" | "remove-background";
/** `queued`: accepted by a batch, waiting its turn behind another image. */
export type ProductImageEnhanceStatus = "idle" | "queued" | "enhancing" | "awaiting-review";

export interface ProductImageEnhanceReviewItem {
  id: string;
  operation: ProductImageOperation;
  framingMode: ProductImageFramingMode;
  originalUrl: string;
  enhancedKey: string;
  enhancedUrl: string;
  creditsCharged: number;
}

export interface ProductImageEnhanceBatchProgress {
  current: number;
  total: number;
}

/** One image + the operation to run on it, so a queue can mix both operations. */
export interface ProductImageOperationTarget {
  imageUrl: string;
  operation: ProductImageOperation;
}

/** What a finished queue produced — lets a caller branch on "nothing came back". */
export interface ProductImageQueueOutcome {
  /** Enhanced objects staged for review (0 = every target failed or was skipped). */
  produced: number;
  /** The merchant stopped it: a neutral outcome, not a failure to report. */
  cancelled: boolean;
}

export interface ProductImageEnhanceCredits {
  /**
   * Credits are metered on this instance (cloud). False on self-host, where no
   * credit UI must appear at all.
   */
  enabled: boolean;
  /** Flat per-image tariffs resolved by the server (0 = free). */
  enhanceCredits: number;
  bgRemovalCredits: number;
  /** Remaining balance; `null` means unlimited (never blocks). */
  totalCredits: number | null;
  isLoading: boolean;
  /** The balance cannot cover a single enhancement. */
  isExhausted: boolean;
  /** Persistent inline alert after prior usage or a mid-batch 402. */
  showExhaustedAlert: boolean;
  dismissExhaustedAlert: () => void;
  /** Images "enhance all" would actually process (already-AI ones excluded). */
  batchTargetCount: number;
}

export interface ProductImageEnhanceControls {
  /**
   * Server-resolved availability. The controls stay visible when false: they
   * then open the promo dialog instead of running the enhancement.
   */
  enabled: boolean;
  backgroundRemovalEnabled: boolean;
  statusByImage: Record<string, ProductImageEnhanceStatus>;
  /** Which operation each in-flight image is running — drives the step labels. */
  operationByImage: Record<string, ProductImageOperation>;
  isRunning: boolean;
  /** A cancellation is in flight — the buttons stay disabled until it lands. */
  isCancelling: boolean;
  batchProgress: ProductImageEnhanceBatchProgress | null;
  credits: ProductImageEnhanceCredits;
  /** Balance check for a single image of that operation (true when unmetered). */
  canAffordOperation: (operation: ProductImageOperation) => boolean;
  /** Opens the educational top-up dialog without starting a doomed request. */
  showCreditsDialog: () => void;
  enhanceImage: (imageUrl: string) => void;
  removeBackground: (imageUrl: string) => void;
  enhanceAllImages: () => void;
  /** Aborts the running request and stops the rest of the queue. */
  cancelRun: () => void;
}

interface UseProductImageEnhanceParams {
  enabled: boolean;
  backgroundRemovalEnabled: boolean;
  productId?: string;
  imagesPreviews: string[];
  /**
   * Swaps an accepted enhanced object into form state. Returns `false` when the
   * original image is no longer part of the form (the caller then drops the
   * enhanced object instead of leaking it).
   */
  replaceImage: (
    originalUrl: string,
    enhancedUrl: string,
    operation: ProductImageOperation,
  ) => boolean;
  /** Keeps the generated object in the lineage without making it active. */
  keepGeneratedImage: (
    originalUrl: string,
    enhancedUrl: string,
    operation: ProductImageOperation,
  ) => boolean;
}

export type ProductImageEnhancePromoReason = "feature-unavailable" | "credits-required";

interface ProductImageEnhanceResponse {
  key: string;
  url: string;
  creditsCharged: number;
  framingMode: ProductImageFramingMode;
}

const ENHANCE_ERROR_CODES = [
  "credits_exhausted",
  "ai_image_disabled",
  "background_removal_disabled",
  "invalid_image",
  "empty_image",
  "provider_error",
  "background_removal_error",
  "already_processed",
] as const;

type ProductImageEnhanceErrorCode = (typeof ENHANCE_ERROR_CODES)[number] | "unknown";

// Codes that make the rest of a batch pointless: stop the queue right away.
const FATAL_ENHANCE_ERROR_CODES: ProductImageEnhanceErrorCode[] = [
  "credits_exhausted",
  "ai_image_disabled",
  "background_removal_disabled",
];

class ProductImageEnhanceError extends Error {
  constructor(readonly code: ProductImageEnhanceErrorCode) {
    super(code);
    this.name = "ProductImageEnhanceError";
  }
}

function toEnhanceErrorCode(code: unknown): ProductImageEnhanceErrorCode {
  return ENHANCE_ERROR_CODES.find((known) => known === code) ?? "unknown";
}

function createReviewItemId(imageKey: string) {
  return `product-image-enhance-${Date.now()}-${imageKey}-${Math.random().toString(36).slice(2, 8)}`;
}

async function requestProcessedImage(
  imageKey: string,
  imageUrl: string,
  productId: string | undefined,
  operation: ProductImageOperation,
  signal: AbortSignal,
): Promise<ProductImageEnhanceResponse> {
  const response = await fetch(ENHANCE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageKey, imageUrl, productId, operation }),
    // Aborting this also aborts the server's `request.signal`, which is what
    // stops the provider call and, above all, prevents the debit.
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new ProductImageEnhanceError(toEnhanceErrorCode(payload?.code));
  }

  return (await response.json()) as ProductImageEnhanceResponse;
}

export function useProductImageEnhance({
  enabled,
  backgroundRemovalEnabled,
  productId,
  imagesPreviews,
  replaceImage,
  keepGeneratedImage,
}: UseProductImageEnhanceParams) {
  const t = useTranslations("dashboard.products.form");
  const { deleteImage } = useImageUpload("product");
  const queryClient = useQueryClient();

  const [statusByImage, setStatusByImage] = useState<Record<string, ProductImageEnhanceStatus>>({});
  const [operationByImage, setOperationByImage] = useState<Record<string, ProductImageOperation>>(
    {},
  );
  const [reviewItems, setReviewItems] = useState<ProductImageEnhanceReviewItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ProductImageEnhanceBatchProgress | null>(null);
  // The same value-first pitch handles activation and an empty wallet, with a
  // reason-specific CTA at the end.
  const [enhancePromoReason, setEnhancePromoReason] =
    useState<ProductImageEnhancePromoReason | null>(null);
  // Sticky trace of a server-side refusal: a toast alone disappears while the
  // merchant is still looking at a half-processed batch.
  const [hasCreditsError, setHasCreditsError] = useState(false);

  // Balance is only worth fetching where the controls can actually spend.
  const balanceQuery = useQuery({
    ...aiCreditsQueries.balance(),
    enabled: enabled || backgroundRemovalEnabled,
  });
  const balance = balanceQuery.data;
  const creditsEnabled = balance?.enabled === true;
  const enhanceCredits = balance?.imageEnhanceCredits ?? 0;
  const bgRemovalCredits = balance?.imageBgRemovalCredits ?? 0;
  const totalCredits = creditsEnabled ? (balance?.totalCredits ?? null) : null;
  const hasUsedCredits = balance?.hasUsedCredits === true;

  // `null` = unlimited allowance, and an unknown balance never blocks: the
  // server stays the single source of truth (402) in both cases.
  const canAfford = useCallback(
    (cost: number) => {
      if (!creditsEnabled || cost <= 0 || totalCredits === null) return true;
      return totalCredits >= cost;
    },
    [creditsEnabled, totalCredits],
  );

  const getOperationCost = useCallback(
    (operation: ProductImageOperation) =>
      operation === "remove-background" ? bgRemovalCredits : enhanceCredits,
    [bgRemovalCredits, enhanceCredits],
  );

  const canAffordOperation = useCallback(
    (operation: ProductImageOperation) => canAfford(getOperationCost(operation)),
    [canAfford, getOperationCost],
  );

  const isExhausted = !canAfford(enhanceCredits);

  const refreshBalance = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: aiCreditsQueries.balance().queryKey });
  }, [queryClient]);

  // A zero balance is not an error for a newcomer. Only merchants who have
  // actually spent credits, or whose request was refused server-side, see the
  // persistent interruption state.
  const showCreditsAlert = creditsEnabled && (hasCreditsError || (isExhausted && hasUsedCredits));

  const dismissExhaustedAlert = useCallback(() => {
    setHasCreditsError(false);
  }, []);

  const raiseCreditsAlert = useCallback(() => {
    setHasCreditsError(true);
  }, []);

  const openEnhancePromo = useCallback(() => {
    setEnhancePromoReason("feature-unavailable");
  }, []);

  const showCreditsDialog = useCallback(() => {
    setEnhancePromoReason("credits-required");
  }, []);

  const closeEnhancePromo = useCallback(() => {
    setEnhancePromoReason(null);
  }, []);

  const isRunningRef = useRef(false);
  // The in-flight request, so the merchant can drop a 200s generation.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Sticky for the whole run: cancelling one image also stops the rest of the
  // batch, and survives the window where the response is already in flight.
  const isCancelledRef = useRef(false);
  const deleteImageRef = useRef(deleteImage);
  const replaceImageRef = useRef(replaceImage);
  const keepGeneratedImageRef = useRef(keepGeneratedImage);

  useEffect(() => {
    deleteImageRef.current = deleteImage;
  }, [deleteImage]);

  useEffect(() => {
    replaceImageRef.current = replaceImage;
  }, [replaceImage]);

  useEffect(() => {
    keepGeneratedImageRef.current = keepGeneratedImage;
  }, [keepGeneratedImage]);

  const setImageStatus = useCallback(
    (imageUrl: string, status: ProductImageEnhanceStatus, operation?: ProductImageOperation) => {
      setStatusByImage((prev) => {
        if (status === "idle") {
          if (!(imageUrl in prev)) return prev;
          const { [imageUrl]: _removed, ...rest } = prev;
          return rest;
        }

        if (prev[imageUrl] === status) return prev;
        return { ...prev, [imageUrl]: status };
      });

      setOperationByImage((prev) => {
        if (status === "idle") {
          if (!(imageUrl in prev)) return prev;
          const { [imageUrl]: _removed, ...rest } = prev;
          return rest;
        }

        if (!operation || prev[imageUrl] === operation) return prev;
        return { ...prev, [imageUrl]: operation };
      });
    },
    [],
  );

  const getEnhanceErrorMessage = useCallback(
    (code: ProductImageEnhanceErrorCode) => {
      switch (code) {
        case "credits_exhausted":
          return t("aiEnhanceErrorCredits");
        case "ai_image_disabled":
          return t("aiEnhanceErrorDisabled");
        case "background_removal_disabled":
          return t("removeBackgroundErrorDisabled");
        case "invalid_image":
          return t("aiEnhanceErrorInvalidImage");
        case "empty_image":
          return t("aiEnhanceErrorEmptyImage");
        case "provider_error":
          return t("aiEnhanceErrorProvider");
        case "background_removal_error":
          return t("removeBackgroundErrorProvider");
        case "already_processed":
          return t("aiEnhanceErrorAlreadyProcessed");
        default:
          return t("aiEnhanceError");
      }
    },
    [t],
  );

  const runImageQueue = useCallback(
    async (queueTargets: ProductImageOperationTarget[]): Promise<ProductImageQueueOutcome> => {
      if (isRunningRef.current) return { produced: 0, cancelled: false };

      const targets = queueTargets.filter((target) => Boolean(target.imageUrl));
      if (targets.length === 0) return { produced: 0, cancelled: false };

      isRunningRef.current = true;
      isCancelledRef.current = false;
      setIsCancelling(false);
      setIsRunning(true);
      // Claim the whole batch up front: the images waiting their turn have to
      // say so, otherwise a batch sent to the background looks like a single
      // image being processed and the others forgotten. `stillQueued` tracks
      // the claims to release if the queue breaks before reaching them.
      const stillQueued = new Set(targets.map((target) => target.imageUrl));
      for (const target of targets) {
        setImageStatus(target.imageUrl, "queued", target.operation);
      }
      const collected: ProductImageEnhanceReviewItem[] = [];
      // Captured in `finally`, before the refs are reset for the next run.
      let wasCancelled = false;

      try {
        for (let index = 0; index < targets.length; index += 1) {
          // A cancellation stops the whole queue, not just the running image.
          if (isCancelledRef.current) break;

          const { imageUrl, operation } = targets[index];
          if (targets.length > 1) {
            setBatchProgress({ current: index + 1, total: targets.length });
          }

          const imageKey = getImageKeyFromUrl(imageUrl);
          if (!imageKey) {
            toastManager.add({ title: t("aiEnhanceError"), type: "error" });
            continue;
          }

          stillQueued.delete(imageUrl);
          setImageStatus(imageUrl, "enhancing", operation);

          const controller = new AbortController();
          abortControllerRef.current = controller;

          try {
            const enhanced = await requestProcessedImage(
              imageKey,
              imageUrl,
              productId,
              operation,
              controller.signal,
            );
            // No "unmounted" check here: leaving the page only hides it (Cache
            // Components keep the form state), so a result that lands meanwhile
            // still belongs to the form. Deleting it broke saved products
            // (Gleap #847).
            // The response beat the abort: the server had already committed, so
            // the object exists (and was billed). Honour the cancellation by
            // discarding it through the same path a rejected review uses.
            if (isCancelledRef.current) {
              void deleteImageRef.current(enhanced.url).catch(() => undefined);
              setImageStatus(imageUrl, "idle");
              // This is the one window where a cancellation still costs: the
              // debit landed before the abort reached the server. Re-read the
              // balance so what the merchant sees stays true.
              if (enhanced.creditsCharged > 0) refreshBalance();
              toastManager.add({ title: t("aiEnhanceCancelled") });
              break;
            }
            const didKeepGeneratedImage = keepGeneratedImageRef.current(
              imageUrl,
              enhanced.url,
              operation,
            );
            if (!didKeepGeneratedImage) {
              void deleteImageRef.current(enhanced.url).catch(() => undefined);
              setImageStatus(imageUrl, "idle");
              toastManager.add({ title: t("aiEnhanceOriginalMissing"), type: "error" });
              continue;
            }
            // The media form owns this object from now on. Persist it in the
            // lineage before review so closing or keeping the original can
            // never discard an already generated (and potentially billed) file.
            // The debit already happened server-side: keep the displayed
            // balance honest while the rest of the batch runs.
            if (enhanced.creditsCharged > 0) refreshBalance();
            setHasCreditsError(false);
            const reviewItem: ProductImageEnhanceReviewItem = {
              id: createReviewItemId(imageKey),
              operation,
              framingMode: enhanced.framingMode,
              originalUrl: imageUrl,
              enhancedKey: enhanced.key,
              enhancedUrl: enhanced.url,
              creditsCharged: enhanced.creditsCharged,
            };
            collected.push(reviewItem);
            // Published as it lands, not once the batch is over: the tile is
            // already badged "to review", so the result has to be decidable
            // while the remaining photos keep processing.
            setReviewItems((prev) => [...prev, reviewItem]);
            setImageStatus(imageUrl, "awaiting-review", operation);
          } catch (error) {
            setImageStatus(imageUrl, "idle");

            // The merchant pulled the plug: acknowledge it quietly and stop.
            // Not an error toast, and explicitly no credits alert — nothing was
            // billed, so nothing about their balance changed.
            const isAborted =
              isCancelledRef.current || (error instanceof Error && error.name === "AbortError");
            if (isAborted) {
              toastManager.add({ title: t("aiEnhanceCancelled") });
              break;
            }

            const code =
              error instanceof ProductImageEnhanceError ? error.code : ("unknown" as const);
            if (code === "unknown") {
              console.error("Product image enhance error:", error);
            }
            if (code === "credits_exhausted") {
              if (collected.length === 0 && !hasUsedCredits) {
                showCreditsDialog();
              } else {
                // A previously active wallet, or a batch that really stopped
                // mid-way, keeps the interruption visible beside the photos.
                raiseCreditsAlert();
              }
              refreshBalance();
            } else {
              toastManager.add({
                title: getEnhanceErrorMessage(code),
                type: "error",
              });
            }

            if (FATAL_ENHANCE_ERROR_CODES.includes(code)) break;
          }
        }
      } finally {
        wasCancelled = isCancelledRef.current;
        isRunningRef.current = false;
        abortControllerRef.current = null;
        isCancelledRef.current = false;
        setIsCancelling(false);
        setIsRunning(false);
        setBatchProgress(null);
        // A break (cancellation, fatal error) leaves the rest of the batch
        // claimed: release anything still waiting for a turn it will never get.
        for (const imageUrl of stillQueued) {
          setImageStatus(imageUrl, "idle");
        }
      }

      return { produced: collected.length, cancelled: wasCancelled };
    },
    [
      getEnhanceErrorMessage,
      hasUsedCredits,
      productId,
      raiseCreditsAlert,
      refreshBalance,
      setImageStatus,
      showCreditsDialog,
      t,
    ],
  );

  /**
   * Drops the running request and the rest of the queue. Images already
   * processed keep their staged result — cancelling means "stop here", not
   * "throw away what I already paid for".
   */
  const cancelRun = useCallback(() => {
    if (!isRunningRef.current) return;
    isCancelledRef.current = true;
    setIsCancelling(true);
    abortControllerRef.current?.abort();
  }, []);

  const enhanceImage = useCallback(
    (imageUrl: string) => {
      if (!canApplyProductImageOperation(imageUrl, "enhance")) return;
      if (!enabled) {
        openEnhancePromo();
        return;
      }
      // Spare the merchant a round-trip that can only come back as a 402.
      if (!canAfford(enhanceCredits)) {
        showCreditsDialog();
        return;
      }
      void runImageQueue([{ imageUrl, operation: "enhance" }]);
    },
    [canAfford, enabled, enhanceCredits, openEnhancePromo, runImageQueue, showCreditsDialog],
  );

  const removeBackground = useCallback(
    (imageUrl: string) => {
      if (!canApplyProductImageOperation(imageUrl, "remove-background")) return;
      if (!backgroundRemovalEnabled) {
        toastManager.add({
          title: t("removeBackgroundErrorDisabled"),
          type: "error",
        });
        return;
      }
      if (!canAfford(bgRemovalCredits)) {
        showCreditsDialog();
        return;
      }
      void runImageQueue([{ imageUrl, operation: "remove-background" }]);
    },
    [backgroundRemovalEnabled, bgRemovalCredits, canAfford, runImageQueue, showCreditsDialog, t],
  );

  // Batch entry point for callers that already hold a list of uploaded URLs
  // (e.g. images flagged from the crop dialog). Mixed operations are supported:
  // the queue stays sequential so a single run drives the whole session.
  const processImages = useCallback(
    async (targets: ProductImageOperationTarget[]): Promise<ProductImageQueueOutcome> => {
      const runnable = targets.filter(
        (target) =>
          (target.operation === "remove-background" ? backgroundRemovalEnabled : enabled) &&
          canApplyProductImageOperation(target.imageUrl, target.operation),
      );
      if (runnable.length === 0) return { produced: 0, cancelled: false };

      // A single unaffordable operation would stop the queue server-side anyway.
      if (runnable.some((target) => !canAffordOperation(target.operation))) {
        showCreditsDialog();
        return { produced: 0, cancelled: false };
      }

      return runImageQueue(runnable);
    },
    [backgroundRemovalEnabled, canAffordOperation, enabled, runImageQueue, showCreditsDialog],
  );

  // Objects the route minted are already isolated and centered — re-running
  // them through the provider would only re-bill for an identical result.
  const batchTargets = useMemo(
    () => imagesPreviews.filter((url) => getProductImageProcessingKind(url) === null),
    [imagesPreviews],
  );

  const enhanceAllImages = useCallback(() => {
    if (!enabled) {
      openEnhancePromo();
      return;
    }
    if (!canAfford(enhanceCredits)) {
      showCreditsDialog();
      return;
    }
    void runImageQueue(
      batchTargets.map((imageUrl) => ({ imageUrl, operation: "enhance" as const })),
    );
  }, [
    batchTargets,
    canAfford,
    enabled,
    enhanceCredits,
    openEnhancePromo,
    runImageQueue,
    showCreditsDialog,
  ]);

  const dismissReviewItem = useCallback(
    (item: ProductImageEnhanceReviewItem) => {
      setReviewItems((prev) => prev.filter((current) => current.id !== item.id));
      setImageStatus(item.originalUrl, "idle");
    },
    [setImageStatus],
  );

  const acceptEnhancedImage = useCallback(
    (itemId: string) => {
      const item = reviewItems.find((current) => current.id === itemId);
      if (!item) return;

      // The object is already safe in the history. Accepting only changes which
      // version the product currently uses.
      const didReplace = replaceImageRef.current(
        item.originalUrl,
        item.enhancedUrl,
        item.operation,
      );

      if (!didReplace) {
        toastManager.add({ title: t("aiEnhanceOriginalMissing"), type: "error" });
      }

      dismissReviewItem(item);
    },
    [dismissReviewItem, reviewItems, t],
  );

  const rejectEnhancedImage = useCallback(
    (itemId: string) => {
      const item = reviewItems.find((current) => current.id === itemId);
      if (!item) return;

      // The result entered the lineage as soon as generation succeeded. This
      // decision only keeps the original selected.
      toastManager.add({ title: t("aiEnhanceSavedToHistory") });
      dismissReviewItem(item);
    },
    [dismissReviewItem, reviewItems, t],
  );

  // Closing the review keeps every original selected. Generated versions were
  // already transferred to the form history when their response arrived.
  const closeEnhanceReview = useCallback(() => {
    for (const item of reviewItems) {
      setImageStatus(item.originalUrl, "idle");
    }
    setReviewItems([]);
  }, [reviewItems, setImageStatus]);

  const credits = useMemo<ProductImageEnhanceCredits>(
    () => ({
      enabled: creditsEnabled,
      enhanceCredits,
      bgRemovalCredits,
      totalCredits,
      isLoading: balanceQuery.isPending,
      isExhausted,
      showExhaustedAlert: showCreditsAlert,
      dismissExhaustedAlert,
      batchTargetCount: batchTargets.length,
    }),
    [
      balanceQuery.isPending,
      batchTargets.length,
      bgRemovalCredits,
      creditsEnabled,
      dismissExhaustedAlert,
      enhanceCredits,
      isExhausted,
      showCreditsAlert,
      totalCredits,
    ],
  );

  const imageEnhance = useMemo<ProductImageEnhanceControls>(
    () => ({
      enabled,
      backgroundRemovalEnabled,
      statusByImage,
      operationByImage,
      isRunning,
      isCancelling,
      batchProgress,
      credits,
      canAffordOperation,
      showCreditsDialog,
      enhanceImage,
      removeBackground,
      enhanceAllImages,
      cancelRun,
    }),
    [
      backgroundRemovalEnabled,
      batchProgress,
      canAffordOperation,
      cancelRun,
      credits,
      enabled,
      enhanceAllImages,
      enhanceImage,
      isCancelling,
      isRunning,
      operationByImage,
      removeBackground,
      showCreditsDialog,
      statusByImage,
    ],
  );

  return {
    imageEnhance,
    processImages,
    enhanceReviewItems: reviewItems,
    isEnhanceReviewOpen: reviewItems.length > 0,
    acceptEnhancedImage,
    rejectEnhancedImage,
    closeEnhanceReview,
    isEnhancePromoOpen: enhancePromoReason !== null,
    enhancePromoReason,
    openEnhancePromo,
    closeEnhancePromo,
  };
}
