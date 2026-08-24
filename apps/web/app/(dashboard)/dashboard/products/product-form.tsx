"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingKind, PricingMode } from "@louez/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  StepActions,
  toastManager,
} from "@louez/ui";
import { getCurrencySymbol, minutesToPriceDuration, priceDurationToMinutes } from "@louez/utils";
import {
  type PricingTierInput as LegacyPricingTierInput,
  type ProductUnitInput,
  type RateTierInput,
  createProductSchema,
} from "@louez/validations";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";

import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";

import { ProductAssuranceSection } from "./components/product-assurance-section";
import { ProductFormEditToc } from "./components/product-form-edit-toc";
import { ProductFormSectionAccessories } from "./components/product-form-section-accessories";
import { ProductFormSectionProduct } from "./components/product-form-section-product";
import { ProductFormSectionStock } from "./components/product-form-section-stock";
import { ProductFormStepPricing } from "./components/product-form-step-pricing";
import { ProductFormSummaryPanel } from "./components/product-form-summary-panel";
import { ProductImageCropDialog } from "./components/product-image-crop-dialog";
import { ProductImageEnhanceDialog } from "./components/product-image-enhance-dialog";
import { ProductImageEnhancePromoDialog } from "./components/product-image-enhance-promo-dialog";
import { useProductFormMedia } from "./hooks/use-product-form-media";
import { useProductFormMutations } from "./hooks/use-product-form-mutations";
import { getProductSeasonalPricings } from "./seasonal-actions";
import type {
  BookingAttributeAxisData,
  Category,
  ProductFormComponentApi,
  ProductFormProps,
  ProductFormValues,
  SeasonalPricingData,
} from "./types";
import { createInitialProductImageHistory } from "./utils/util.product-image-history";

type ProductFormSubmitIntent = "save" | "save-and-duplicate";
const PRODUCT_COPY_DRAFT_STORAGE_KEY = "louez:product-copy-draft";

interface ProductFormSubmitMeta {
  intent: ProductFormSubmitIntent;
}

function buildProductCopyDraft<T extends ProductFormValues>(value: T, copySuffix: string): T {
  const copyName = value.name.endsWith(copySuffix) ? value.name : `${value.name} ${copySuffix}`;

  return {
    ...value,
    name: copyName,
    status: "active",
    units: (value.units ?? []).map((unit) => {
      if (!("purchasedAt" in unit) || !(unit.purchasedAt instanceof Date)) {
        return unit;
      }

      return {
        ...unit,
        purchasedAt: unit.purchasedAt.toISOString().slice(0, 10),
      };
    }),
  } as T;
}

function saveProductCopyDraft(value: ProductFormValues) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PRODUCT_COPY_DRAFT_STORAGE_KEY, JSON.stringify(value));
}

function clearProductCopyDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PRODUCT_COPY_DRAFT_STORAGE_KEY);
}

function pricingModeToUnit(mode: PricingMode): "hour" | "day" | "week" {
  if (mode === "hour") return "hour";
  if (mode === "week") return "week";
  return "day";
}

function pricingModeToMinutes(mode: PricingMode): number {
  if (mode === "hour") return 60;
  if (mode === "week") return 10080;
  return 1440;
}

function getDuplicateRateTierIndexes(rateTiers: RateTierInput[] | undefined): number[] {
  if (!rateTiers?.length) return [];

  const byPeriod = new Map<number, number[]>();

  rateTiers.forEach((tier, index) => {
    const period = priceDurationToMinutes(tier.duration, tier.unit);
    const existing = byPeriod.get(period);
    if (existing) {
      existing.push(index);
      return;
    }
    byPeriod.set(period, [index]);
  });

  const duplicates = new Set<number>();
  for (const indexes of byPeriod.values()) {
    if (indexes.length < 2) continue;
    indexes.forEach((index) => duplicates.add(index));
  }

  return Array.from(duplicates).sort((a, b) => a - b);
}

export function ProductForm({
  product,
  categories,
  currency = "EUR",
  storeTaxSettings,
  availableAccessories = [],
  showAiContext = false,
  imageEnhanceEnabled = false,
  imageBackgroundRemovalEnabled = false,
}: ProductFormProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.products.form");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const currencySymbol = getCurrencySymbol(currency);

  const isEditMode = !!product;
  const queryClient = useQueryClient();
  const {
    isSaving,
    submitProduct,
    markImagesPersisted,
    getActionErrorMessage,
    getActionErrorDetails,
  } = useProductFormMutations({
    productId: product?.id,
    initialImages: product?.images ?? [],
    initialImageHistory: product?.imageHistory ?? [],
  });

  // Categories live in the React Query cache, seeded with the server-rendered
  // list; creations update the cache directly (no router.refresh needed).
  const categoriesQuery = useQuery(
    orpc.dashboard.categories.list.queryOptions({ initialData: categories }),
  );
  const allCategories: Category[] = categoriesQuery.data ?? categories;

  const createCategoryMutation = useMutation(
    orpc.dashboard.categories.create.mutationOptions({
      onSuccess: (created) => {
        queryClient.setQueryData(
          orpc.dashboard.categories.list.key({ type: "query" }),
          (prev: Category[] | undefined) => {
            if (!prev) return [created];
            return prev.some((category) => category.id === created.id) ? prev : [...prev, created];
          },
        );
        void queryClient.invalidateQueries({
          queryKey: orpc.dashboard.categories.key(),
        });
      },
    }),
  );
  const isCreatingCategory = createCategoryMutation.isPending;
  const [duplicateRateTierIndexes, setDuplicateRateTierIndexes] = useState<number[]>([]);
  const [pendingDuplicateRateTierIndexes, setPendingDuplicateRateTierIndexes] = useState<
    number[] | null
  >(null);
  const hasShownDuplicateRateToastRef = useRef(false);
  const markMediaUploadsPersistedRef = useRef<() => void>(() => undefined);

  // Seasonal pricing state (edit mode only)
  const [seasonalPricings, setSeasonalPricings] = useState<SeasonalPricingData[]>([]);
  const [selectedSeasonalPeriodId, setSelectedSeasonalPeriodId] = useState<string | null>(null);
  const [isLoadingSeasonalPricings, setIsLoadingSeasonalPricings] = useState(false);

  useEffect(() => {
    if (!product?.id) return;
    setIsLoadingSeasonalPricings(true);
    getProductSeasonalPricings(product.id).then((result) => {
      if (result && "data" in result) {
        setSeasonalPricings(result.data as SeasonalPricingData[]);
      }
      setIsLoadingSeasonalPricings(false);
    });
  }, [product?.id]);

  // When seasonal pricings are emptied (signal to reload), refetch
  useEffect(() => {
    if (!product?.id || seasonalPricings.length > 0) return;
    if (isLoadingSeasonalPricings) return;
    // Only reload if we had a selected period (meaning a duplicate happened)
    if (!selectedSeasonalPeriodId) return;
    setIsLoadingSeasonalPricings(true);
    getProductSeasonalPricings(product.id).then((result) => {
      if (result && "data" in result) {
        setSeasonalPricings(result.data as SeasonalPricingData[]);
      }
      setIsLoadingSeasonalPricings(false);
    });
  }, [product?.id, seasonalPricings.length, isLoadingSeasonalPricings, selectedSeasonalPeriodId]);

  // Convert product pricing tiers to input format
  const initialPricingTiers: LegacyPricingTierInput[] =
    product?.pricingTiers?.map((tier) => ({
      id: tier.id,
      minDuration: tier.minDuration ?? 1,
      discountPercent: parseFloat(tier.discountPercent || "0"),
    })) ?? [];

  const initialRateTiers: RateTierInput[] = (() => {
    if (!product?.pricingTiers?.length) return [];
    const basePrice = parseFloat(product.price || "0") || 0;
    const fallbackMode = (product.pricingMode ?? "day") as PricingMode;

    return product.pricingTiers
      .map((tier) => {
        if (tier.price && tier.period) {
          const durationInfo = minutesToPriceDuration(tier.period);
          return {
            id: tier.id,
            price: tier.price,
            duration: durationInfo.duration,
            unit: durationInfo.unit,
            // UI-only: always derive from price/period vs base, never trust persisted legacy value.
            discountPercent: undefined,
          };
        }

        const minDuration = tier.minDuration ?? 1;
        const discount = parseFloat(tier.discountPercent || "0");
        const minutes = minDuration * pricingModeToMinutes(fallbackMode);
        const durationInfo = minutesToPriceDuration(minutes);
        const effectivePerLegacyUnit = basePrice * (1 - discount / 100);
        const totalPrice = effectivePerLegacyUnit * minDuration;

        return {
          id: tier.id,
          price: totalPrice.toFixed(2),
          duration: durationInfo.duration,
          unit: durationInfo.unit,
          discountPercent: discount,
        };
      })
      .sort(
        (a, b) =>
          priceDurationToMinutes(a.duration, a.unit) - priceDurationToMinutes(b.duration, b.unit),
      );
  })();

  // Convert product units to input format
  const initialUnits: ProductUnitInput[] =
    product?.units?.map((unit) => ({
      id: unit.id,
      identifier: unit.identifier,
      attributes: unit.attributes || {},
      hasActiveAssignment: unit.hasActiveAssignment ?? false,
    })) ?? [];

  const initialBookingAttributeAxes: BookingAttributeAxisData[] =
    product?.bookingAttributeAxes?.map((axis, index) => ({
      key: axis.key,
      label: axis.label,
      position: axis.position ?? index,
    })) ?? [];

  const productFormSchema = useMemo(() => createProductSchema(tValidation), [tValidation]);
  const validationFieldLabels = useMemo(
    () =>
      new Map([
        ["accessoryIds", t("accessories")],
        ["basePriceDuration", t("baseRate")],
        ["bookingAttributeAxes", t("stock")],
        ["categoryIds", t("category")],
        ["deposit", t("deposit")],
        ["description", t("description")],
        ["images", t("photos")],
        ["name", t("name")],
        // Only fixed pricing validates the flat `price` field on its own.
        ["price", t("fixedPrice")],
        ["quantity", t("stock")],
        ["rateTiers", t("additionalRates")],
        ["status", t("publication")],
        ["units", t("stock")],
        ["videoUrl", t("video")],
      ]),
    [t],
  );

  const scrollToFirstError = useCallback(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const firstInvalidElement = document.querySelector<HTMLElement>(
        '[aria-invalid="true"], [data-invalid="true"], p.text-destructive',
      );
      firstInvalidElement?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      firstInvalidElement?.focus({ preventScroll: true });
    }, 50);
  }, []);

  const initialBasePriceDuration = (() => {
    if (product?.basePeriodMinutes) {
      const period = minutesToPriceDuration(product.basePeriodMinutes);
      return {
        price: product.price || "",
        duration: period.duration,
        unit: period.unit,
      };
    }

    return {
      price: product?.price || "",
      duration: 1,
      unit: pricingModeToUnit((product?.pricingMode ?? "day") as PricingMode),
    };
  })();

  const initialPricingKind: PricingKind = product?.pricingKind ?? "duration";

  const defaultSubmitMeta: ProductFormSubmitMeta = { intent: "save" };
  const form = useAppForm({
    onSubmitMeta: defaultSubmitMeta,
    defaultValues: {
      name: product?.name || "",
      description: product?.description || "",
      aiContext: product?.aiContext || "",
      categoryIds: product?.categoryIds ?? (product?.categoryId ? [product.categoryId] : []),
      price: product?.price || "",
      basePriceDuration: initialBasePriceDuration,
      deposit: product?.deposit ?? "",
      quantity: product?.quantity != null ? product.quantity.toString() : "1",
      status: (product?.status ?? "active") as "draft" | "active" | "archived",
      images: product?.images ?? [],
      imageHistory: createInitialProductImageHistory(
        product?.images ?? [],
        product?.imageHistory ?? [],
      ),
      pricingKind: initialPricingKind,
      pricingMode: (product?.pricingMode ?? "day") as PricingMode,
      pricingTiers: initialPricingTiers,
      rateTiers: initialRateTiers,
      enforceStrictTiers: product?.enforceStrictTiers ?? true,
      taxSettings: product?.taxSettings ?? { inheritFromStore: true },
      videoUrl: product?.videoUrl || "",
      accessoryIds: product?.accessoryIds ?? [],
      trackUnits: product?.trackUnits || false,
      units: initialUnits,
      bookingAttributeAxes: initialBookingAttributeAxes,
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: productFormSchema },
    onSubmitInvalid: ({ value }) => {
      const validationResult = productFormSchema.safeParse(value);
      const validationDetails = validationResult.success
        ? []
        : Array.from(
            new Set(
              validationResult.error.issues.map((issue) => {
                const rootField = String(issue.path[0] ?? "");
                const fieldLabel = validationFieldLabels.get(rootField);
                return fieldLabel ? `${fieldLabel} : ${issue.message}` : issue.message;
              }),
            ),
          );

      toastManager.add({
        title: t("validationError"),
        description: validationDetails.slice(0, 3).join(" · ") || undefined,
        type: "error",
      });
      scrollToFirstError();
    },
    onSubmit: async ({ value, meta }) => {
      const copyDraft =
        meta.intent === "save-and-duplicate" ? buildProductCopyDraft(value, t("copySuffix")) : null;

      if (copyDraft) {
        saveProductCopyDraft(copyDraft);
      } else {
        clearProductCopyDraft();
      }

      try {
        await submitProduct(value);
        markMediaUploadsPersistedRef.current();
        setDuplicateRateTierIndexes([]);
        setPendingDuplicateRateTierIndexes(null);

        if (copyDraft) {
          form.reset(copyDraft);
          toastManager.add({
            title: t("productCreated"),
            description: t("productCreatedCopyReady"),
            type: "success",
          });
          window.setTimeout(clearProductCopyDraft, 2000);
          window.setTimeout(() => {
            const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
            nameInput?.scrollIntoView({ behavior: "smooth", block: "center" });
            nameInput?.focus({ preventScroll: true });
            nameInput?.select();
          }, 50);
          return;
        }

        toastManager.add({
          title: product ? t("productUpdated") : t("productCreated"),
          type: "success",
        });
        router.push(product ? `/dashboard/products/${product.id}` : "/dashboard/products");
      } catch (error) {
        if (copyDraft) {
          clearProductCopyDraft();
        }

        const details = getActionErrorDetails(error);
        const isDuplicateRatePeriodsError =
          details?.code === "duplicate_rate_periods" &&
          Array.isArray(details.duplicateRateTierIndexes) &&
          details.duplicateRateTierIndexes.length > 0;

        if (isDuplicateRatePeriodsError) {
          const duplicateIndexes = details.duplicateRateTierIndexes ?? [];
          setPendingDuplicateRateTierIndexes(duplicateIndexes);

          toastManager.add({
            title: t("pricingTiers.duplicateDurationError"),
            type: "error",
          });
          return;
        }

        toastManager.add({
          title: getActionErrorMessage(error),
          type: "error",
        });
      }
    },
  });

  const watchedValues = useStore(form.store, (s) => s.values);
  const submissionAttempts = useStore(form.store, (s) => s.submissionAttempts);
  const rateTiersSubmitError = useStore(
    form.store,
    (s) => s.fieldMeta.rateTiers?.errorMap?.onSubmit,
  );
  const hasUnitsSubmitError = useStore(form.store, (s) =>
    Boolean(s.fieldMeta.units?.errorMap?.onSubmit),
  );
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const imagesPreviews = useStore(form.store, (s) => s.values.images ?? []);
  const imageHistory = useStore(form.store, (s) => s.values.imageHistory ?? []);
  const media = useProductFormMedia({
    form: form as unknown as ProductFormComponentApi,
    productId: product?.id,
    imagesPreviews,
    imageHistory,
    imageEnhanceEnabled,
    imageBackgroundRemovalEnabled,
  });

  useEffect(() => {
    markMediaUploadsPersistedRef.current = media.markUploadsPersisted;
  }, [media.markUploadsPersisted]);

  useEffect(() => {
    if (product || typeof window === "undefined") return;

    const storedDraft = window.sessionStorage.getItem(PRODUCT_COPY_DRAFT_STORAGE_KEY);
    if (!storedDraft) return;

    try {
      const parsedDraft: unknown = JSON.parse(storedDraft);
      const validationResult = productFormSchema.safeParse(parsedDraft);
      if (!validationResult.success) {
        clearProductCopyDraft();
        return;
      }

      form.reset(validationResult.data);
      markImagesPersisted(validationResult.data.images, validationResult.data.imageHistory);
      markMediaUploadsPersistedRef.current();
      clearProductCopyDraft();
    } catch {
      clearProductCopyDraft();
    }
  }, [form, markImagesPersisted, product, productFormSchema]);

  const handleReset = useCallback(() => {
    form.reset();
  }, [form]);

  const handleCreateCategory = useCallback(
    async (name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      try {
        const created = await createCategoryMutation.mutateAsync({
          name: trimmed,
        });
        toastManager.add({ title: t("categoryCreated"), type: "success" });
        return created.id;
      } catch (error) {
        toastManager.add({
          title: getActionErrorMessage(error),
          type: "error",
        });
        return null;
      }
    },
    [createCategoryMutation.mutateAsync, getActionErrorMessage, t],
  );

  const clearSubmitError = useCallback(
    (name: "name" | "price" | "quantity" | "units" | "rateTiers") => {
      form.setFieldMeta(name, (prev) => ({
        ...prev,
        errorMap: {
          ...prev?.errorMap,
          onSubmit: undefined,
        },
      }));
    },
    [form],
  );

  const clearDuplicateRateTierErrors = useCallback(() => {
    setDuplicateRateTierIndexes((prev) => (prev.length > 0 ? [] : prev));
    setPendingDuplicateRateTierIndexes(null);
    clearSubmitError("rateTiers");
  }, [clearSubmitError]);

  // Fixed pricing keeps any rate tiers around in form state but never submits
  // them, so their duplicates must not block the save.
  const localDuplicateRateTierIndexes = useMemo(
    () =>
      watchedValues.pricingKind === "fixed"
        ? []
        : getDuplicateRateTierIndexes(watchedValues.rateTiers as RateTierInput[]),
    [watchedValues.pricingKind, watchedValues.rateTiers],
  );
  const effectiveDuplicateRateTierIndexes = useMemo(
    () =>
      Array.from(new Set([...duplicateRateTierIndexes, ...localDuplicateRateTierIndexes])).sort(
        (a, b) => a - b,
      ),
    [duplicateRateTierIndexes, localDuplicateRateTierIndexes],
  );

  useEffect(() => {
    if (!pendingDuplicateRateTierIndexes?.length) return;

    setDuplicateRateTierIndexes(pendingDuplicateRateTierIndexes);
    form.setFieldMeta("rateTiers", (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: t("pricingTiers.duplicateDurationError"),
      },
    }));

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("section-pricing")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    setPendingDuplicateRateTierIndexes(null);
  }, [form, pendingDuplicateRateTierIndexes, t]);

  useEffect(() => {
    const hasDuplicateRates = localDuplicateRateTierIndexes.length > 0;
    const hasSubmitted = submissionAttempts > 0;

    if (!hasDuplicateRates || !hasSubmitted) {
      hasShownDuplicateRateToastRef.current = false;
      return;
    }

    form.setFieldMeta("rateTiers", (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: t("pricingTiers.duplicateDurationError"),
      },
    }));

    if (!hasShownDuplicateRateToastRef.current) {
      toastManager.add({
        title: t("pricingTiers.duplicateDurationError"),
        type: "error",
      });
      hasShownDuplicateRateToastRef.current = true;
    }
  }, [form, localDuplicateRateTierIndexes, submissionAttempts, t, rateTiersSubmitError]);

  const selectedCategories = allCategories.filter((c) =>
    (watchedValues.categoryIds ?? []).includes(c.id),
  );

  const effectivePricingMode: PricingMode =
    watchedValues.basePriceDuration?.unit === "week"
      ? "week"
      : watchedValues.basePriceDuration?.unit === "day"
        ? "day"
        : "hour";

  const durationPriceLabel =
    effectivePricingMode === "day"
      ? t("pricePerDay")
      : effectivePricingMode === "hour"
        ? t("pricePerHour")
        : t("pricePerWeek");
  const priceLabel =
    watchedValues.pricingKind === "fixed" ? t("fixedPriceLabel") : durationPriceLabel;

  // Edit mode: single column with sticky TOC on desktop
  if (isEditMode) {
    return (
      <>
        <form.AppForm>
          <form.Form>
            <div className="relative flex gap-10">
              <ProductFormEditToc />

              <div className="min-w-0 flex-1 space-y-6">
                <div id="section-product" className="scroll-mt-8">
                  <ProductFormSectionProduct
                    form={form as unknown as ProductFormComponentApi}
                    showAiContext={showAiContext}
                    categories={allCategories}
                    onCreateCategory={handleCreateCategory}
                    isCreatingCategory={isCreatingCategory}
                    onNameInputChange={(event, handleChange) => {
                      form.setFieldMeta("name", (prev) => ({
                        ...prev,
                        errorMap: { ...prev?.errorMap, onSubmit: undefined },
                      }));
                      handleChange(event.target.value);
                    }}
                    imagesPreviews={imagesPreviews}
                    isDragging={media.isDragging}
                    isUploadingImages={media.isUploadingImages}
                    handleImageUpload={media.handleImageUpload}
                    handleDragOver={media.handleDragOver}
                    handleDragEnter={media.handleDragEnter}
                    handleDragLeave={media.handleDragLeave}
                    handleDrop={media.handleDrop}
                    removeImage={media.removeImage}
                    reorderImages={media.reorderImages}
                    recropImage={media.recropImage}
                    canRecrop={true}
                    imageEnhance={media.imageEnhance}
                    imageHistory={imageHistory}
                    selectImageVersion={media.selectImageVersion}
                    deleteImageVersion={media.deleteImageVersion}
                  />
                </div>

                <div id="section-pricing" className="scroll-mt-8">
                  <ProductFormStepPricing
                    form={form as unknown as ProductFormComponentApi}
                    watchedValues={watchedValues}
                    currency={currency}
                    currencySymbol={currencySymbol}
                    isSaving={isSaving}
                    duplicateRateTierIndexes={effectiveDuplicateRateTierIndexes}
                    onRateTiersEdit={clearDuplicateRateTierErrors}
                    storeTaxSettings={storeTaxSettings}
                    availableAccessories={availableAccessories}
                    showAccessories={false}
                    showStock={false}
                    showValidationErrors={submissionAttempts > 0}
                    showUnitValidationErrors={hasUnitsSubmitError || submissionAttempts > 0}
                    productId={product?.id}
                    seasonalPricings={seasonalPricings}
                    selectedSeasonalPeriodId={selectedSeasonalPeriodId}
                    onSelectSeasonalPeriod={setSelectedSeasonalPeriodId}
                    onSeasonalPricingsChange={setSeasonalPricings}
                    isLoadingSeasonalPricings={isLoadingSeasonalPricings}
                  />
                </div>

                <div id="section-stock" className="scroll-mt-8">
                  <ProductFormSectionStock
                    form={form as unknown as ProductFormComponentApi}
                    productId={product.id}
                    watchedValues={watchedValues}
                    currency={currency}
                    disabled={isSaving}
                    showValidationErrors={hasUnitsSubmitError || submissionAttempts > 0}
                  />
                </div>

                <div id="section-accessories" className="scroll-mt-8">
                  <ProductFormSectionAccessories
                    form={form as unknown as ProductFormComponentApi}
                    availableAccessories={availableAccessories}
                    currency={currency}
                    disabled={isSaving}
                  />
                </div>

                {product?.id ? <ProductAssuranceSection productId={product.id} /> : null}
              </div>
            </div>

            <FloatingSaveBar isDirty={isDirty} isLoading={isSaving} onReset={handleReset} />
          </form.Form>
        </form.AppForm>

        <ProductImageCropDialog
          open={media.isCropDialogOpen}
          items={media.cropQueueItems}
          selectedIndex={media.selectedCropIndex}
          canGoToPrevious={media.canGoToPreviousCropItem}
          canGoToNext={media.canGoToNextCropItem}
          isUploading={media.isUploadingImages}
          isPreparing={media.isPreparingCrop}
          isFreshSession={media.isFreshCropSession}
          imageEnhance={media.imageEnhance}
          aiSession={media.cropAiSession}
          reviewItems={media.enhanceReviewItems}
          onClose={media.closeCropDialog}
          onSelectIndex={media.setSelectedCropIndex}
          onPrevious={media.goToPreviousCropItem}
          onNext={media.goToNextCropItem}
          onCropChange={media.setCropRect}
          onCropComplete={media.setCropAreaPixels}
          onCropSizeChange={media.setCropSizePercent}
          onApplyCrop={media.applyCurrentCropAndProceed}
          onSkipCrop={media.keepCurrentCropOriginalAndProceed}
          onStartAi={media.startAiOnCurrentCropImage}
          onEnhanceAll={media.enhanceAllCropImages}
          onRetryAi={media.retryCropAiSession}
          onResolveReviewItem={media.resolveCropAiReviewItem}
          onReplaceCurrentImage={media.replaceCurrentCropImage}
        />

        <ProductImageEnhanceDialog
          open={media.isEnhanceReviewOpen}
          items={media.enhanceReviewItems}
          onAccept={media.acceptEnhancedImage}
          onReject={media.rejectEnhancedImage}
          onClose={media.closeEnhanceReview}
        />

        <ProductImageEnhancePromoDialog
          open={media.isEnhancePromoOpen}
          onClose={media.closeEnhancePromo}
          reason={media.enhancePromoReason ?? "feature-unavailable"}
          creditsPerImage={media.imageEnhance.credits.enhanceCredits}
        />
      </>
    );
  }

  // Create mode: single page with form sections + sticky summary panel
  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-6">
              <div id="section-product" className="scroll-mt-8">
                <ProductFormSectionProduct
                  form={form as unknown as ProductFormComponentApi}
                  showAiContext={showAiContext}
                  categories={allCategories}
                  onCreateCategory={handleCreateCategory}
                  isCreatingCategory={isCreatingCategory}
                  onNameInputChange={(event, handleChange) => {
                    form.setFieldMeta("name", (prev) => ({
                      ...prev,
                      errorMap: { ...prev?.errorMap, onSubmit: undefined },
                    }));
                    handleChange(event.target.value);
                  }}
                  imagesPreviews={imagesPreviews}
                  isDragging={media.isDragging}
                  isUploadingImages={media.isUploadingImages}
                  handleImageUpload={media.handleImageUpload}
                  handleDragOver={media.handleDragOver}
                  handleDragEnter={media.handleDragEnter}
                  handleDragLeave={media.handleDragLeave}
                  handleDrop={media.handleDrop}
                  removeImage={media.removeImage}
                  reorderImages={media.reorderImages}
                  recropImage={media.recropImage}
                  canRecrop={false}
                  imageEnhance={media.imageEnhance}
                  imageHistory={imageHistory}
                  selectImageVersion={media.selectImageVersion}
                  deleteImageVersion={media.deleteImageVersion}
                />
              </div>

              <div id="section-pricing" className="scroll-mt-8">
                <ProductFormStepPricing
                  form={form as unknown as ProductFormComponentApi}
                  watchedValues={watchedValues}
                  currency={currency}
                  currencySymbol={currencySymbol}
                  isSaving={isSaving}
                  duplicateRateTierIndexes={effectiveDuplicateRateTierIndexes}
                  onRateTiersEdit={clearDuplicateRateTierErrors}
                  storeTaxSettings={storeTaxSettings}
                  availableAccessories={availableAccessories}
                  showAccessories={false}
                  showValidationErrors={submissionAttempts > 0}
                  showUnitValidationErrors={hasUnitsSubmitError || submissionAttempts > 0}
                />
              </div>
            </div>

            <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:w-80 xl:w-88">
              <ProductFormSummaryPanel
                form={form as unknown as ProductFormComponentApi}
                watchedValues={watchedValues}
                imagesPreviews={imagesPreviews}
                selectedCategories={selectedCategories}
                priceLabel={priceLabel}
                currency={currency}
              />
            </aside>
          </div>

          {/* Actions */}
          <StepActions>
            <div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  clearProductCopyDraft();
                  router.push("/dashboard/products");
                }}
              >
                {tCommon("cancel")}
              </Button>
            </div>

            <div className="inline-flex">
              {/* `!`: the StepActions mobile rule rounds every button with a
                  higher-specificity descendant selector — the split seam must
                  stay flat. */}
              <Button
                type="submit"
                size="lg"
                className="rounded-r-none max-sm:rounded-r-none!"
                isPending={isSaving}
              >
                <Check data-slot="icon" />
                {t("createProduct")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="lg"
                      className="rounded-l-none border-l-primary-foreground/20 px-2.5 max-sm:rounded-l-none!"
                      aria-label={t("createAndDuplicate")}
                      disabled={isSaving}
                    />
                  }
                >
                  <ChevronDown data-slot="icon" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => form.handleSubmit({ intent: "save-and-duplicate" })}
                  >
                    <Copy />
                    {t("createAndDuplicate")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </StepActions>
        </form.Form>
      </form.AppForm>

      <ProductImageCropDialog
        open={media.isCropDialogOpen}
        items={media.cropQueueItems}
        selectedIndex={media.selectedCropIndex}
        canGoToPrevious={media.canGoToPreviousCropItem}
        canGoToNext={media.canGoToNextCropItem}
        isUploading={media.isUploadingImages}
        isPreparing={media.isPreparingCrop}
        isFreshSession={media.isFreshCropSession}
        imageEnhance={media.imageEnhance}
        aiSession={media.cropAiSession}
        reviewItems={media.enhanceReviewItems}
        onClose={media.closeCropDialog}
        onSelectIndex={media.setSelectedCropIndex}
        onPrevious={media.goToPreviousCropItem}
        onNext={media.goToNextCropItem}
        onCropChange={media.setCropRect}
        onCropComplete={media.setCropAreaPixels}
        onCropSizeChange={media.setCropSizePercent}
        onApplyCrop={media.applyCurrentCropAndProceed}
        onSkipCrop={media.keepCurrentCropOriginalAndProceed}
        onStartAi={media.startAiOnCurrentCropImage}
        onEnhanceAll={media.enhanceAllCropImages}
        onRetryAi={media.retryCropAiSession}
        onResolveReviewItem={media.resolveCropAiReviewItem}
        onReplaceCurrentImage={media.replaceCurrentCropImage}
      />

      <ProductImageEnhanceDialog
        open={media.isEnhanceReviewOpen}
        items={media.enhanceReviewItems}
        onAccept={media.acceptEnhancedImage}
        onReject={media.rejectEnhancedImage}
        onClose={media.closeEnhanceReview}
      />

      <ProductImageEnhancePromoDialog
        open={media.isEnhancePromoOpen}
        onClose={media.closeEnhancePromo}
        reason={media.enhancePromoReason ?? "feature-unavailable"}
        creditsPerImage={media.imageEnhance.credits.enhanceCredits}
      />
    </>
  );
}
