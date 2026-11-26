"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calendar, Check, FileText, PenLine, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import type { CapacityShortfall } from "@louez/api/contracts/reservations";
import type { PricingMode, UnitAttributes } from "@louez/types";
import { toastManager } from "@louez/ui";
import { Button } from "@louez/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import { InputPrice, StepActions, Tabs, TabsList, TabsTrigger } from "@louez/ui";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";
import { Label } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import { NewReservationPartnerCard } from "@/components/dashboard/partners/new-reservation-partner-card";
import { ReservationGateDialog } from "@/components/dashboard/reservation-gate-dialog";
import { ReservationOverbookingDialog } from "@/components/dashboard/reservation-overbooking-dialog";
import { isReservationGateRefusal } from "@/lib/billing/reservation-gate-error";
import { isInsufficientCapacityResult } from "@/lib/reservations/util.insufficient-capacity";
import { invalidateManualCreationQuotes, invalidateReservationList } from "@/lib/orpc/invalidation";
import { trackOpenReplayEvent } from "@/lib/openreplay/client";
import { openReplayEvents } from "@/lib/openreplay/events";
import { orpc } from "@/lib/orpc/react";
import { partnersMutations } from "@/lib/queries/partners.queries";
import {
  dashboardReservationAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";
import { formatStoreDate } from "@/lib/utils/store-date";

import { useAppForm } from "@/hooks/form/form";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { useMediaQuery } from "@/hooks/use-media-query";

import { useStoreTimezone } from "@/contexts/store-context";

import { getManualReservationAvailability } from "../actions";
import { NewReservationConfirmDrawer } from "./components/new-reservation-confirm-drawer";
import { NewReservationCustomItemDialog } from "./components/new-reservation-custom-item-dialog";
import { NewReservationStepCustomer } from "./components/new-reservation-step-customer";
import { NewReservationStepDelivery } from "./components/new-reservation-step-delivery";
import { NewReservationStepProducts } from "./components/new-reservation-step-products";
import {
  NewReservationSummaryPanel,
  type ReservationSectionId,
} from "./components/new-reservation-summary-panel";
import { useNewReservationDelivery } from "./hooks/use-new-reservation-delivery";
import { useNewReservationPricing } from "./hooks/use-new-reservation-pricing";
import { usePricingModeLabels } from "./hooks/use-pricing-mode-labels";
import {
  getPeriodAvailability,
  useNewReservationWarnings,
} from "./hooks/use-new-reservation-warnings";
import { useReservationDurationLabel } from "./hooks/use-reservation-duration-label";
import type {
  Customer,
  CustomItem,
  NewReservationFormComponentApi,
  NewReservationFormProps,
  NewReservationFormValues,
  SelectedProduct,
  StepFieldName,
} from "./types";
import { buildRecapDeliveryLeg, buildRecapItemLines } from "./utils/recap-lines";
import { creationTotals } from "./utils/creation-totals";
import type { CustomItemValues } from "./utils/custom-item-form";
import { buildProductCombinations, getLineQuantityConstraints } from "./utils/variant-lines";
import { createManualReservationSchema } from "./validation";

function createLineId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type PriceOverrideMode = "unit" | "total" | "percent";

export function NewReservationForm({
  onReservationCreated,
  openReplaySource,
  customers,
  products,
  tulipInsuranceMode,
  businessHours,
  advanceNoticeMinutes = 0,
  pendingBlocksAvailability = true,
  turnoverBufferMinutes = 0,
  existingReservations = [],
  deliverySettings,
  storeLatitude,
  storeLongitude,
  storeAddress,
  storeLocations,
  taxSettings,
  currency,
  pricedAt,
}: NewReservationFormProps & { onReservationCreated: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const timezone = useStoreTimezone();
  const t = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");
  const { intl: formatLocale } = useFormatLocale();
  const posthog = usePostHog();

  useEffect(() => {
    trackOpenReplayEvent(openReplayEvents.dashboardReservationCreationStarted, {
      journey: "reservation_creation",
      step: "started",
      source: openReplaySource,
    });

    posthog.capture(productAnalyticsEvents.dashboardReservationCreationStarted, {
      ...dashboardReservationAnalyticsBaseProperties,
      source: openReplaySource,
    });
  }, [openReplaySource, posthog]);

  const getTimeSlotsForDate = (date: Date | undefined): { minTime: string; maxTime: string } => {
    void date;
    return { minTime: "00:00", maxTime: "23:30" };
  };

  const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);

  // Default time for new date selections: current time rounded up to next 30min slot
  const defaultTimeSlot = useMemo(() => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const rounded = Math.ceil(totalMinutes / 30) * 30;
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (h >= 24) return "23:30";
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }, []);

  const [createdCustomers, setCreatedCustomers] = useState<Customer[]>([]);
  const [gateDialogOpen, setGateDialogOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  // Each opening is a new session, which the dialog is keyed by: it starts from
  // the item edited, or empty.
  const [customItemDialog, setCustomItemDialog] = useState<{
    open: boolean;
    item: CustomItem | null;
    session: number;
  }>({ open: false, item: null, session: 0 });
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(true);
  const [globalDiscount, setGlobalDiscount] = useState<{
    mode: "amount" | "percent";
    value: number | null;
  }>({ mode: "amount", value: null });
  const [depositOverride, setDepositOverride] = useState<number | null>(null);
  const sendAsQuoteRef = useRef(false);
  const [tulipInsuranceOptIn, setTulipInsuranceOptIn] = useState(
    tulipInsuranceMode === "required" || tulipInsuranceMode === "optional",
  );
  const [overbookingDialog, setOverbookingDialog] = useState<{
    isOpen: boolean;
    shortfalls: CapacityShortfall[];
  }>({
    isOpen: false,
    shortfalls: [],
  });

  // Below `lg` the summary aside stacks under every section, far from the
  // sticky action bar — matches the `lg:flex-row` switch on the layout below.
  const isSummaryBelowFold = useMediaQuery("(max-width: 1023px)");
  const [confirmDrawer, setConfirmDrawer] = useState<{ isOpen: boolean; asQuote: boolean }>({
    isOpen: false,
    asQuote: false,
  });
  const pendingSubmitValuesRef = useRef<NewReservationFormValues | null>(null);

  const isDeliveryEnabled = Boolean(
    (deliverySettings?.enabled && storeLatitude != null && storeLongitude != null) ||
    deliverySettings?.multiLocationEnabled,
  );

  // Price override dialog state. The admin can express the new price as a
  // unit price, a total for the period, or a discount percentage — all three
  // resolve to the same stored unit price.
  const [priceOverrideDialog, setPriceOverrideDialog] = useState<{
    isOpen: boolean;
    lineId: string | null;
    currentPrice: number;
    pricingMode: PricingMode;
    duration: number;
    quantity: number;
    mode: PriceOverrideMode;
    value: number | null;
  }>({
    isOpen: false,
    lineId: null,
    currentPrice: 0,
    pricingMode: "day",
    duration: 0,
    quantity: 1,
    mode: "unit",
    value: null,
  });

  // Liens partenaires: the partner who sent this customer, credited once it is created.
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const creditPartnerMutation = useMutation(partnersMutations.setForReservation());

  const createReservationMutation = useMutation({
    ...orpc.dashboard.reservations.createManualReservation.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationList(queryClient);
      },
    }),
  });

  const getActionErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      if (error.message.startsWith("errors.")) {
        return tErrors(error.message.replace("errors.", ""));
      }
      return error.message;
    }

    return tErrors("generic");
  };

  const getFieldErrorMessage = (error: unknown) => {
    if (typeof error === "string" && error.length > 0) {
      return error;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }

    return tErrors("generic");
  };

  function trackStepValidationFailed(stepId: string, failedFields: string[]) {
    posthog.capture(productAnalyticsEvents.dashboardReservationStepValidationFailed, {
      ...dashboardReservationAnalyticsBaseProperties,
      step: stepId,
      failed_fields: failedFields,
      source: openReplaySource,
    });
  }

  type SectionValidationFailure = {
    section: ReservationSectionId;
    failedFields: string[];
  };

  const scrollToSection = (sectionId: ReservationSectionId) => {
    document
      .getElementById(`section-${sectionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const getSectionErrorMessage = (sectionId: ReservationSectionId) => {
    switch (sectionId) {
      case "customer":
        return t("selectCustomerError");
      case "period":
        return t("selectDatesError");
      case "products":
        return t("addItemError");
      case "delivery":
        return t("deliveryHasError");
    }
  };

  // Sections whose state lives outside the form (product lines, delivery hook)
  // are validated here; form fields are covered by the Zod schema.
  function getNonFieldSectionFailures(): SectionValidationFailure[] {
    const failures: SectionValidationFailure[] = [];

    if (selectedProducts.length === 0 && customItems.length === 0) {
      failures.push({ section: "products", failedFields: ["items"] });
    }

    if (isDeliveryEnabled && !delivery.canContinue) {
      failures.push({ section: "delivery", failedFields: ["delivery"] });
    }

    return failures;
  }

  function getFieldSectionFailures(): SectionValidationFailure[] {
    const sections: Array<[ReservationSectionId, StepFieldName[]]> = [
      ["customer", ["customerId"]],
      ["period", ["startDate", "endDate"]],
    ];

    const failures: SectionValidationFailure[] = [];
    for (const [section, fields] of sections) {
      const failedFields = fields.filter(
        (name) => (form.getFieldMeta(name)?.errors?.length ?? 0) > 0,
      );
      if (failedFields.length > 0) {
        failures.push({ section, failedFields });
      }
    }

    return failures;
  }

  const handleInvalidSections = (failures: SectionValidationFailure[]) => {
    if (failures.length === 0) return;

    for (const failure of failures) {
      trackStepValidationFailed(failure.section, failure.failedFields);
    }

    toastManager.add({
      title: getSectionErrorMessage(failures[0].section),
      type: "error",
    });
    scrollToSection(failures[0].section);
  };

  const submitManualReservation = async (
    value: NewReservationFormValues,
    options: { allowOverbooking?: boolean } = {},
  ) => {
    if (!value.startDate || !value.endDate) {
      toastManager.add({ title: t("selectDatesError"), type: "error" });
      return;
    }

    try {
      const effectiveTulipInsuranceOptIn =
        tulipInsuranceMode === "required"
          ? true
          : tulipInsuranceMode === "optional"
            ? tulipInsuranceOptIn
            : false;

      const result = await createReservationMutation.mutateAsync({
        payload: {
          customerId: value.customerId,
          startDate: value.startDate,
          endDate: value.endDate,
          items: selectedProducts,
          customItems: customItems.map((item) => ({
            name: item.name,
            description: item.description,
            unitPrice: item.unitPrice,
            deposit: item.deposit,
            quantity: item.quantity,
            pricingMode: item.pricingMode,
          })),
          delivery: {
            outbound:
              delivery.outboundMethod === "address" &&
              delivery.outboundAddress.latitude !== null &&
              delivery.outboundAddress.longitude !== null
                ? {
                    method: "address" as const,
                    address: delivery.outboundAddress.address,
                    city: delivery.outboundAddress.city,
                    postalCode: delivery.outboundAddress.postalCode,
                    country: delivery.outboundAddress.country,
                    latitude: delivery.outboundAddress.latitude,
                    longitude: delivery.outboundAddress.longitude,
                  }
                : {
                    method: "store" as const,
                    locationId: delivery.pickupLocationId,
                  },
            return:
              delivery.returnMethod === "address" &&
              delivery.returnAddress.latitude !== null &&
              delivery.returnAddress.longitude !== null
                ? {
                    method: "address" as const,
                    address: delivery.returnAddress.address,
                    city: delivery.returnAddress.city,
                    postalCode: delivery.returnAddress.postalCode,
                    country: delivery.returnAddress.country,
                    latitude: delivery.returnAddress.latitude,
                    longitude: delivery.returnAddress.longitude,
                  }
                : {
                    method: "store" as const,
                    locationId: delivery.returnLocationId,
                  },
          },
          internalNotes: value.internalNotes || undefined,
          discountAmount:
            globalDiscountAmount > 0 ? Math.round(globalDiscountAmount * 100) / 100 : undefined,
          depositOverride: depositOverride ?? undefined,
          tulipInsuranceOptIn: effectiveTulipInsuranceOptIn,
          sendConfirmationEmail: sendAsQuoteRef.current ? true : sendConfirmationEmail,
          sendAsQuote: sendAsQuoteRef.current,
          allowOverbooking: options.allowOverbooking,
          // What the person confirms: the server refuses a creation whose total differs.
          expectedTotal: totals.total,
        },
      });

      if (isInsufficientCapacityResult(result)) {
        posthog.capture(productAnalyticsEvents.dashboardReservationCapacityBlocked, {
          ...dashboardReservationAnalyticsBaseProperties,
          shortfall_count: result.shortfalls.length,
          shortfall_product_ids: result.shortfalls.map((shortfall) => shortfall.productId),
          source: openReplaySource,
        });
        setOverbookingDialog({
          isOpen: true,
          shortfalls: result.shortfalls,
        });
        return;
      }

      if ("error" in result && result.error) {
        posthog.capture(productAnalyticsEvents.dashboardReservationCreationFailed, {
          ...dashboardReservationAnalyticsBaseProperties,
          error_code: result.error,
          source: openReplaySource,
        });
        toastManager.add({
          title: tErrors(result.error.replace("errors.", "")),
          type: "error",
        });
        return;
      }

      trackOpenReplayEvent(openReplayEvents.dashboardReservationCreationCompleted, {
        journey: "reservation_creation",
        step: "completed",
        source: openReplaySource,
      });

      toastManager.add({
        title: sendAsQuoteRef.current ? t("quoteSent") : t("reservationCreated"),
        type: "success",
      });
      if (partnerId && result.reservationId) {
        // The reservation exists either way; a failed credit is set again from its page.
        await creditPartnerMutation
          .mutateAsync({ reservationId: result.reservationId, partnerId })
          .catch(() => toastManager.add({ title: t("partnerNotCredited"), type: "warning" }));
      }
      onReservationCreated();
      router.replace(`/dashboard/reservations/${result.reservationId}`);
    } catch (error) {
      posthog.capture(productAnalyticsEvents.dashboardReservationCreationFailed, {
        ...dashboardReservationAnalyticsBaseProperties,
        error_code: error instanceof Error ? error.message : "unknown",
        source: openReplaySource,
      });
      if (isReservationGateRefusal(error)) {
        setGateDialogOpen(true);
        return;
      }
      // A price, a rate, the display mode, the insurer's premium or a route
      // changed while the form was open: what it prices from is read again,
      // the page and the outside quotes alike, and it shows the total the
      // next attempt is compared with.
      if (error instanceof Error && error.message === "errors.reservationChangedMeanwhile") {
        router.refresh();
        void invalidateManualCreationQuotes(queryClient).then(delivery.remeasure);
      }
      toastManager.add({
        title: getActionErrorMessage(error),
        type: "error",
      });
    }
  };

  const reservationSchema = useMemo(
    () => createManualReservationSchema(tValidation),
    [tValidation],
  );

  const form = useAppForm({
    defaultValues: {
      customerId: "",
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
      internalNotes: "",
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onSubmit: reservationSchema,
    },
    onSubmitInvalid: () => {
      handleInvalidSections([...getFieldSectionFailures(), ...getNonFieldSectionFailures()]);
    },
    onSubmit: async ({ value }) => {
      const failures = getNonFieldSectionFailures();
      if (failures.length > 0) {
        handleInvalidSections(failures);
        return;
      }

      // The recap is a confirmation, not a validation step: it only opens
      // once the payload is known-good, so confirming it can never bounce
      // the user back into the form.
      if (isSummaryBelowFold) {
        pendingSubmitValuesRef.current = value;
        setConfirmDrawer({ isOpen: true, asQuote: sendAsQuoteRef.current });
        return;
      }

      await submitManualReservation(value);
    },
  });

  const watchCustomerId = useStore(form.store, (s) => s.values.customerId);
  const watchStartDate = useStore(form.store, (s) => s.values.startDate as Date | undefined);
  const watchEndDate = useStore(form.store, (s) => s.values.endDate as Date | undefined);
  const watchedValues = useStore(form.store, (s) => s.values as NewReservationFormValues);
  const isSaving = createReservationMutation.isPending;

  // Customers created from the picker are live in DB but absent from the server-rendered list.
  const allCustomers = useMemo(
    () => [...createdCustomers, ...customers],
    [createdCustomers, customers],
  );
  const selectedCustomer = allCustomers.find((c) => c.id === watchCustomerId);
  const isNewCustomer = createdCustomers.some((c) => c.id === watchCustomerId);

  const handleCustomerCreated = (customer: Customer) => {
    setCreatedCustomers((prev) => [customer, ...prev]);
    form.setFieldValue("customerId", customer.id);
    clearStepFieldError("customerId");
  };

  const hasSelectedPeriod = Boolean(watchStartDate && watchEndDate);
  const availabilityProductIds = useMemo(() => products.map((product) => product.id), [products]);
  const manualAvailabilityQuery = useQuery({
    queryKey: [
      "manual-reservation-availability",
      watchStartDate?.toISOString() ?? null,
      watchEndDate?.toISOString() ?? null,
      availabilityProductIds,
    ],
    queryFn: async () => {
      if (!watchStartDate || !watchEndDate) {
        return null;
      }

      const result = await getManualReservationAvailability({
        startDate: watchStartDate.toISOString(),
        endDate: watchEndDate.toISOString(),
        productIds: availabilityProductIds,
      });

      if (!result.success) {
        throw new Error(result.error ?? "errors.invalidData");
      }

      return result.availability.products;
    },
    enabled: hasSelectedPeriod,
    staleTime: 30_000,
  });
  const serviceAvailability =
    manualAvailabilityQuery.data && !manualAvailabilityQuery.isError
      ? manualAvailabilityQuery.data
      : undefined;

  const { periodWarnings, availabilityWarnings } = useNewReservationWarnings({
    startDate: watchStartDate,
    endDate: watchEndDate,
    selectedProducts,
    products,
    businessHours,
    advanceNoticeMinutes,
    pendingBlocksAvailability,
    turnoverBufferMinutes,
    existingReservations,
    serviceAvailability,
  });
  const periodAvailability = useMemo(
    () =>
      getPeriodAvailability({
        startDate: watchStartDate,
        endDate: watchEndDate,
        pendingBlocksAvailability,
        turnoverBufferMinutes,
        existingReservations,
        serviceAvailability,
      }),
    [
      existingReservations,
      pendingBlocksAvailability,
      serviceAvailability,
      turnoverBufferMinutes,
      watchEndDate,
      watchStartDate,
    ],
  );
  const getPeriodProductAvailability = useCallback(
    (productId: string) => periodAvailability.productsById.get(productId),
    [periodAvailability],
  );

  const {
    calculateDurationForMode,
    duration,
    detailedDuration,
    hasItems,
    subtotal,
    originalSubtotal,
    deposit,
    totalSavings,
    getProductPricingDetails,
    getCustomItemTotal,
  } = useNewReservationPricing({
    startDate: watchStartDate,
    endDate: watchEndDate,
    pricedAt,
    selectedProducts,
    customItems,
    products,
  });

  const effectiveTulipInsuranceOptInForPreview =
    tulipInsuranceMode === "required"
      ? true
      : tulipInsuranceMode === "optional"
        ? tulipInsuranceOptIn
        : false;
  const tulipInsuranceQuoteItems = useMemo(
    () =>
      selectedProducts
        .filter((item) => item.productId && item.quantity > 0)
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
    [selectedProducts],
  );
  const tulipInsuranceQuoteRequest = useMemo(() => {
    if (
      !effectiveTulipInsuranceOptInForPreview ||
      !watchStartDate ||
      !watchEndDate ||
      watchEndDate < watchStartDate ||
      tulipInsuranceQuoteItems.length === 0
    ) {
      return null;
    }

    if (!watchCustomerId?.trim()) {
      return null;
    }

    return {
      startDate: watchStartDate.toISOString(),
      endDate: watchEndDate.toISOString(),
      tulipInsuranceOptIn: true,
      items: tulipInsuranceQuoteItems,
      customerId: watchCustomerId,
    };
  }, [
    effectiveTulipInsuranceOptInForPreview,
    tulipInsuranceQuoteItems,
    watchCustomerId,
    watchEndDate,
    watchStartDate,
  ]);
  const tulipInsuranceQuoteInput = {
    payload:
      tulipInsuranceQuoteRequest ??
      ({
        startDate: (watchStartDate ?? new Date()).toISOString(),
        endDate: (watchEndDate ?? watchStartDate ?? new Date()).toISOString(),
        tulipInsuranceOptIn: false,
        items: [],
      } as const),
  };
  const tulipInsuranceQuoteQuery = useQuery({
    ...orpc.dashboard.reservations.previewManualTulipQuote.queryOptions({
      input: tulipInsuranceQuoteInput,
    }),
    enabled: tulipInsuranceQuoteRequest !== null,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isTulipInsuranceQuoteLoading =
    tulipInsuranceQuoteRequest !== null &&
    (tulipInsuranceQuoteQuery.isLoading ||
      (tulipInsuranceQuoteQuery.isFetching && !tulipInsuranceQuoteQuery.data));
  const tulipInsuranceQuotePreview = tulipInsuranceQuoteQuery.data;
  const isTulipInsuranceApplied =
    effectiveTulipInsuranceOptInForPreview && tulipInsuranceQuotePreview?.appliedOptIn === true;
  const tulipInsuranceAmount =
    isTulipInsuranceApplied && tulipInsuranceQuotePreview.amount > 0
      ? tulipInsuranceQuotePreview.amount
      : 0;
  const tulipInsuranceQuoteErrorKey = tulipInsuranceQuoteQuery.isError
    ? "errors.tulipQuoteFailed"
    : (tulipInsuranceQuotePreview?.quoteError ?? null);
  const tulipInsuranceQuoteErrorMessage = tulipInsuranceQuoteErrorKey
    ? tErrors(tulipInsuranceQuoteErrorKey.replace("errors.", ""))
    : null;
  const delivery = useNewReservationDelivery({
    deliverySettings,
    storeLatitude,
    storeLongitude,
    subtotal: subtotal + tulipInsuranceAmount,
  });

  // Commercial discount resolved in currency units; the % mode applies to the
  // pre-delivery subtotal (products + custom items + insurance), like the
  // server-side clamp.
  const discountBase = subtotal + tulipInsuranceAmount;
  const globalDiscountAmount =
    globalDiscount.value == null || globalDiscount.value <= 0
      ? 0
      : globalDiscount.mode === "amount"
        ? Math.min(globalDiscount.value, discountBase)
        : Math.min((discountBase * globalDiscount.value) / 100, discountBase);

  const addProduct = (productId: string, options: { allowUnavailable?: boolean } = {}) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }

    const bookingAttributeAxes = product.bookingAttributeAxes || [];
    const supportsOptionLines = product.trackUnits && bookingAttributeAxes.length > 0;

    setSelectedProducts((prev) => {
      if (supportsOptionLines) {
        // Pre-select the variant when a single combination remains bookable.
        const availableCombinations = buildProductCombinations(
          product,
          periodAvailability.reservedByProductCombination,
          hasSelectedPeriod,
          getPeriodProductAvailability(product.id),
        ).filter((combination) => combination.availableQuantity > 0);
        const singleCombination =
          availableCombinations.length === 1 ? availableCombinations[0] : null;
        const preselectedAttributes =
          singleCombination && Object.keys(singleCombination.selectedAttributes || {}).length > 0
            ? singleCombination.selectedAttributes
            : undefined;

        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
          ...(preselectedAttributes ? { selectedAttributes: preselectedAttributes } : {}),
        };
        const productLines = [...prev.filter((line) => line.productId === productId), nextLine];
        const constraints = getLineQuantityConstraints(
          product,
          nextLine,
          productLines,
          periodAvailability.reservedByProduct.get(product.id) || 0,
          periodAvailability.reservedByProductCombination,
          hasSelectedPeriod,
          getPeriodProductAvailability(product.id),
        );
        if (
          constraints.lineMaxQuantity !== null &&
          constraints.lineMaxQuantity <= 0 &&
          !options.allowUnavailable
        ) {
          return prev;
        }

        return [...prev, nextLine];
      }

      const existingLine = prev.find((line) => line.productId === productId);
      if (!existingLine) {
        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
        };
        const constraints = getLineQuantityConstraints(
          product,
          nextLine,
          [nextLine],
          periodAvailability.reservedByProduct.get(product.id) || 0,
          periodAvailability.reservedByProductCombination,
          hasSelectedPeriod,
          getPeriodProductAvailability(product.id),
        );
        if (
          constraints.lineMaxQuantity !== null &&
          constraints.lineMaxQuantity <= 0 &&
          !options.allowUnavailable
        ) {
          return prev;
        }

        return [...prev, nextLine];
      }

      const productLines = prev.filter((line) => line.productId === productId);
      const constraints = getLineQuantityConstraints(
        product,
        existingLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity = options.allowUnavailable
        ? existingLine.quantity + 1
        : constraints.lineMaxQuantity === null
          ? existingLine.quantity + 1
        : Math.min(
            existingLine.quantity + 1,
            Math.max(existingLine.quantity, constraints.lineMaxQuantity),
          );

      return prev.map((line) => {
        if (line.lineId !== existingLine.lineId) {
          return line;
        }

        return {
          ...line,
          quantity: nextQuantity,
        };
      });
    });
  };

  // Prefill from query params (e.g. drag-to-create on the product timeline):
  // ?startDate=<ISO>&endDate=<ISO>&productId=<id>
  const didPrefillRef = useRef(false);
  useEffect(() => {
    if (didPrefillRef.current) return;
    didPrefillRef.current = true;

    const parseDateParam = (key: string): Date | null => {
      const value = searchParams.get(key);
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const startDate = parseDateParam("startDate");
    const endDate = parseDateParam("endDate");
    if (startDate && endDate && startDate < endDate) {
      form.setFieldValue("startDate", startDate);
      form.setFieldValue("endDate", endDate);
    }

    const productId = searchParams.get("productId");
    if (productId && products.some((product) => product.id === productId)) {
      addProduct(productId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateQuantity = (lineId: string, delta: number) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId);
      if (!currentLine) {
        return prev;
      }

      if (delta < 0 && currentLine.quantity + delta <= 0) {
        return prev.filter((line) => line.lineId !== lineId);
      }

      const product = products.find((item) => item.id === currentLine.productId);
      if (!product) {
        return prev;
      }

      const productLines = prev.filter((line) => line.productId === currentLine.productId);
      const constraints = getLineQuantityConstraints(
        product,
        currentLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity =
        constraints.lineMaxQuantity === null
          ? Math.max(1, currentLine.quantity + delta)
          : Math.max(
              1,
              Math.min(
                currentLine.quantity + delta,
                Math.max(1, constraints.lineMaxQuantity),
              ),
            );

      if (nextQuantity === currentLine.quantity) {
        return prev;
      }

      return prev.map((line) => {
        if (line.lineId !== lineId) {
          return line;
        }

        return {
          ...line,
          quantity: nextQuantity,
        };
      });
    });
  };

  const updateSelectedAttributes = (lineId: string, axisKey: string, value: string | undefined) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId);
      if (!currentLine) {
        return prev;
      }

      const product = products.find((item) => item.id === currentLine.productId);
      if (!product) {
        return prev;
      }

      const nextAttributes: UnitAttributes = {
        ...currentLine.selectedAttributes,
      };

      if (!value || value === "__none__") {
        delete nextAttributes[axisKey];
      } else {
        nextAttributes[axisKey] = value;
      }

      const nextLine: SelectedProduct = {
        ...currentLine,
        selectedAttributes: Object.keys(nextAttributes).length > 0 ? nextAttributes : undefined,
      };

      const productLines = prev
        .filter((line) => line.productId === currentLine.productId)
        .map((line) => (line.lineId === lineId ? nextLine : line));
      const constraints = getLineQuantityConstraints(
        product,
        nextLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity =
        constraints.lineMaxQuantity === null
          ? nextLine.quantity
          : Math.min(nextLine.quantity, constraints.lineMaxQuantity);

      const normalizedLine: SelectedProduct =
        nextQuantity > 0
          ? {
              ...nextLine,
              quantity: Math.max(1, nextQuantity),
            }
          : {
              ...nextLine,
              quantity: 0,
            };

      return prev
        .map((line) => (line.lineId === lineId ? normalizedLine : line))
        .filter((line) => line.quantity > 0);
    });
  };

  const removeSelectedProductLine = (lineId: string) => {
    setSelectedProducts((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  // Custom item management
  const openCustomItemDialog = (item: CustomItem | null) => {
    setCustomItemDialog((current) => ({ open: true, item, session: current.session + 1 }));
  };

  const saveCustomItem = (values: CustomItemValues) => {
    const editedId = customItemDialog.item?.id;
    if (editedId) {
      setCustomItems((current) =>
        current.map((item) => (item.id === editedId ? { ...values, id: editedId } : item)),
      );
      toastManager.add({ title: t("customItem.updated"), type: "success" });
    } else {
      setCustomItems((current) => [...current, { ...values, id: createLineId() }]);
      toastManager.add({ title: t("customItem.added"), type: "success" });
    }
    setCustomItemDialog((current) => ({ ...current, open: false }));
  };

  const updateCustomItemQuantity = (id: string, delta: number) => {
    setCustomItems(
      customItems
        .map((item) => {
          if (item.id === id) {
            const newQuantity = item.quantity + delta;
            return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
          }
          return item;
        })
        .filter(Boolean) as CustomItem[],
    );
  };

  const removeCustomItem = (id: string) => {
    setCustomItems(customItems.filter((item) => item.id !== id));
  };

  // Price override functions
  const roundCurrency = (value: number) => Math.round(value * 100) / 100;

  const priceOverrideDivisor = priceOverrideDialog.duration * priceOverrideDialog.quantity;

  const resolveOverrideUnitPrice = (state: typeof priceOverrideDialog): number | null => {
    if (state.value == null) return null;
    if (state.mode === "unit") return state.value;
    if (state.mode === "total") {
      const divisor = state.duration * state.quantity;
      return divisor > 0 ? state.value / divisor : state.value;
    }
    return state.currentPrice * (1 - state.value / 100);
  };

  const resolvedOverrideUnitPrice = resolveOverrideUnitPrice(priceOverrideDialog);

  const openPriceOverrideDialog = (
    lineId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number,
    quantity: number,
  ) => {
    const existingOverride = selectedProducts.find((line) => line.lineId === lineId)?.priceOverride;
    setPriceOverrideDialog({
      isOpen: true,
      lineId,
      currentPrice: calculatedPrice,
      pricingMode,
      duration,
      quantity: Math.max(1, quantity),
      mode: "unit",
      value: roundCurrency(existingOverride ? existingOverride.unitPrice : calculatedPrice),
    });
  };

  const setPriceOverrideMode = (mode: PriceOverrideMode) => {
    setPriceOverrideDialog((current) => {
      if (mode === current.mode) return current;

      const divisor = current.duration * current.quantity;
      const unitPrice = resolveOverrideUnitPrice(current) ?? current.currentPrice;
      const value =
        mode === "unit"
          ? roundCurrency(unitPrice)
          : mode === "total"
            ? roundCurrency(unitPrice * divisor)
            : current.currentPrice > 0
              ? roundCurrency((1 - unitPrice / current.currentPrice) * 100)
              : 0;

      return { ...current, mode, value };
    });
  };

  const resetPriceOverride = () => {
    setPriceOverrideDialog((current) => ({
      ...current,
      value:
        current.mode === "unit"
          ? roundCurrency(current.currentPrice)
          : current.mode === "total"
            ? roundCurrency(current.currentPrice * current.duration * current.quantity)
            : 0,
    }));
  };

  const closePriceOverrideDialog = () => {
    setPriceOverrideDialog({
      isOpen: false,
      lineId: null,
      currentPrice: 0,
      pricingMode: "day",
      duration: 0,
      quantity: 1,
      mode: "unit",
      value: null,
    });
  };

  const applyPriceOverride = () => {
    if (!priceOverrideDialog.lineId) return;

    const unitPrice = resolvedOverrideUnitPrice;
    if (unitPrice == null || Number.isNaN(unitPrice) || unitPrice < 0) {
      toastManager.add({ title: t("customItem.priceRequired"), type: "error" });
      return;
    }

    setSelectedProducts((prev) =>
      prev.map((line) => {
        if (line.lineId === priceOverrideDialog.lineId) {
          // Removing the override when the price matches the calculated one.
          if (Math.abs(unitPrice - priceOverrideDialog.currentPrice) < 0.01) {
            const nextLine = { ...line };
            delete nextLine.priceOverride;
            return nextLine;
          }
          return { ...line, priceOverride: { unitPrice } };
        }
        return line;
      }),
    );

    toastManager.add({
      title: t("priceOverride.priceUpdated"),
      type: "success",
    });
    closePriceOverrideDialog();
  };

  const clearStepFieldError = (name: StepFieldName) => {
    form.setFieldMeta(name, (prev) => ({
      ...prev,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: undefined,
      },
    }));
  };

  const { perUnit: getPricingUnitLabel } = usePricingModeLabels();

  const effectiveDeposit = depositOverride ?? deposit;
  // The total the creation writes: the tax engine, as the server computes it (slice 10).
  const totals = creationTotals({
    productLines: selectedProducts.flatMap((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product) return [];
      const pricing = getProductPricingDetails(product, line);
      return [
        {
          subtotal: pricing.lineSubtotal,
          unitPrice: pricing.lineUnitPrice,
          typed: pricing.hasPriceOverride,
          taxSettings: product.taxSettings ?? null,
        },
      ];
    }),
    customLines: customItems.map((item) => ({
      subtotal: getCustomItemTotal(item),
      unitPrice: item.unitPrice,
    })),
    insuranceAmount: tulipInsuranceAmount,
    deliveryFee: delivery.totalFee,
    // Rounded as it is sent.
    discountAmount: Math.round(globalDiscountAmount * 100) / 100,
    deposit: effectiveDeposit,
    taxSettings,
    currency,
  });
  const total = totals.total;
  // How the prices read: with tax included, or before it, with the tax on top.
  const taxDisplay = totals.taxEnabled
    ? { mode: totals.displayMode, taxOnTop: totals.taxAmount ?? 0 }
    : null;
  const durationLabel = useReservationDurationLabel(detailedDuration, duration);

  const recapItemLines = useMemo(
    () =>
      buildRecapItemLines({
        selectedProducts,
        customItems,
        products,
        getProductPricingDetails,
        getCustomItemTotal,
      }),
    [customItems, getCustomItemTotal, getProductPricingDetails, products, selectedProducts],
  );

  const recapOutboundLeg = isDeliveryEnabled
    ? buildRecapDeliveryLeg({
        method: delivery.outboundMethod,
        locationId: delivery.pickupLocationId,
        address: delivery.outboundAddress,
        fee: delivery.outboundFee,
        locations: storeLocations,
      })
    : null;
  const recapReturnLeg = isDeliveryEnabled
    ? buildRecapDeliveryLeg({
        method: delivery.returnMethod,
        locationId: delivery.returnLocationId,
        address: delivery.returnAddress,
        fee: delivery.returnFee,
        locations: storeLocations,
      })
    : null;

  const handleConfirmDrawerSubmit = async () => {
    const value = pendingSubmitValuesRef.current;
    if (!value) return;

    sendAsQuoteRef.current = confirmDrawer.asQuote;

    try {
      await submitManualReservation(value);
    } finally {
      // Closed either way: a success navigates away, and a failure has to
      // hand the screen back — an overbooking dialog cannot open under a
      // sheet that is still covering it.
      setConfirmDrawer((current) => ({ ...current, isOpen: false }));
    }
  };

  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-6">
              <div id="section-customer" className="scroll-mt-8">
                <NewReservationStepCustomer
                  form={form as unknown as NewReservationFormComponentApi}
                  customers={allCustomers}
                  clearStepFieldError={clearStepFieldError}
                  getFieldErrorMessage={getFieldErrorMessage}
                  onCustomerCreated={handleCustomerCreated}
                />
              </div>

              <div id="section-period" className="scroll-mt-8">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      {t("period")}
                    </CardTitle>
                    <CardDescription>{t("periodStepDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <form.AppField name="startDate">
                        {(field) => {
                          const timeSlots = getTimeSlotsForDate(field.state.value);
                          return (
                            <field.ReservationDatePicker
                              id="reservation-start-date"
                              label={t("startDate")}
                              minTime={timeSlots.minTime}
                              maxTime={timeSlots.maxTime}
                              timezone={timezone}
                              onChange={() => clearStepFieldError("startDate")}
                              defaultTime={defaultTimeSlot}
                              range={{
                                role: "start",
                                otherValue: watchEndDate,
                                onOtherChange: (date) => {
                                  form.setFieldValue("endDate", date);
                                  clearStepFieldError("endDate");
                                },
                              }}
                            />
                          );
                        }}
                      </form.AppField>
                      <form.AppField name="endDate">
                        {(field) => {
                          const timeSlots = getTimeSlotsForDate(field.state.value);
                          return (
                            <field.ReservationDatePicker
                              id="reservation-end-date"
                              label={t("endDate")}
                              minTime={timeSlots.minTime}
                              maxTime={timeSlots.maxTime}
                              timezone={timezone}
                              referenceDate={watchStartDate}
                              open={endDatePickerOpen}
                              onOpenChange={setEndDatePickerOpen}
                              onChange={() => clearStepFieldError("endDate")}
                              defaultTime={defaultTimeSlot}
                              range={{
                                role: "end",
                                otherValue: watchStartDate,
                                onOtherChange: (date) => {
                                  form.setFieldValue("startDate", date);
                                  clearStepFieldError("startDate");
                                },
                              }}
                            />
                          );
                        }}
                      </form.AppField>
                    </div>

                    {watchStartDate && watchEndDate && duration > 0 && (
                      <div className="mt-6 space-y-2.5">
                        <div className="bg-card relative flex items-center justify-between gap-3 rounded-xl border px-4 py-3 sm:gap-4">
                          <div className="min-w-0">
                            <p className="text-xs font-medium tabular-nums">
                              {formatStoreDate(
                                watchStartDate,
                                timezone,
                                "d MMM yyyy",
                                formatLocale,
                              )}
                            </p>
                            <p className="text-muted-foreground text-[11px] tabular-nums">
                              {formatStoreDate(
                                watchStartDate,
                                timezone,
                                "HH:mm",
                                formatLocale,
                              )}
                            </p>
                          </div>

                          {detailedDuration && (
                            <span className="bg-card max-w-20 shrink-0 rounded-full border px-2 py-0.5 text-center text-[11px] leading-tight font-semibold text-balance tabular-nums sm:hidden">
                              {[
                                detailedDuration.days > 0 &&
                                  `${detailedDuration.days} ${tCommon("dayUnit", { count: detailedDuration.days })}`,
                                detailedDuration.hours > 0 && `${detailedDuration.hours}h`,
                                detailedDuration.minutes > 0 && `${detailedDuration.minutes} min`,
                              ]
                                .filter(Boolean)
                                .join(" · ") || `0 min`}
                            </span>
                          )}

                          <div className="relative hidden h-3 flex-1 items-center justify-between sm:flex">
                            <div className="timeline-dash-flow absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
                            <div className="relative h-2 w-2 shrink-0">
                              <span className="bg-primary timeline-dot-pulse absolute inset-0 rounded-full" />
                              <span className="bg-primary ring-primary/15 relative block h-2 w-2 rounded-full ring-[3px]" />
                            </div>
                            <div className="relative h-2 w-2 shrink-0">
                              <span className="bg-primary timeline-dot-pulse absolute inset-0 rounded-full [animation-delay:1.2s]" />
                              <span className="bg-primary ring-primary/15 relative block h-2 w-2 rounded-full ring-[3px]" />
                            </div>
                            {detailedDuration && (
                              <span className="bg-card absolute top-1/2 left-1/2 max-w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-center text-[11px] leading-tight font-semibold text-balance tabular-nums">
                                {[
                                  detailedDuration.days > 0 &&
                                    `${detailedDuration.days} ${tCommon("dayUnit", { count: detailedDuration.days })}`,
                                  detailedDuration.hours > 0 && `${detailedDuration.hours}h`,
                                  detailedDuration.minutes > 0 && `${detailedDuration.minutes} min`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || `0 min`}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 text-right">
                            <p className="text-xs font-medium tabular-nums">
                              {formatStoreDate(
                                watchEndDate,
                                timezone,
                                "d MMM yyyy",
                                formatLocale,
                              )}
                            </p>
                            <p className="text-muted-foreground text-[11px] tabular-nums">
                              {formatStoreDate(
                                watchEndDate,
                                timezone,
                                "HH:mm",
                                formatLocale,
                              )}
                            </p>
                          </div>
                        </div>

                        {periodWarnings.length > 0 && (
                          <div className="space-y-1.5">
                            {periodWarnings.map((warning, index) => (
                              <div
                                key={`${warning.type}-${warning.field}-${index}`}
                                className="bg-warning/10 flex items-start gap-2.5 rounded-lg px-3 py-2"
                              >
                                <AlertTriangle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-foreground text-xs font-medium">
                                    {warning.message}
                                  </p>
                                  {warning.details && (
                                    <p className="text-muted-foreground text-[11px]">
                                      {warning.details}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                            <p className="text-muted-foreground flex items-center gap-1.5 px-1 pt-1 text-[11px]">
                              <ShieldCheckIcon className="h-3 w-3" />
                              {t("warnings.canContinue")}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div id="section-products" className="scroll-mt-8">
                <NewReservationStepProducts
                  products={products}
                  selectedProducts={selectedProducts}
                  customItems={customItems}
                  tulipInsuranceMode={tulipInsuranceMode}
                  tulipInsuranceOptIn={tulipInsuranceOptIn}
                  tulipInsuranceAmount={tulipInsuranceAmount}
                  isTulipInsuranceQuoteLoading={isTulipInsuranceQuoteLoading}
                  tulipInsuranceQuoteErrorMessage={tulipInsuranceQuoteErrorMessage}
                  startDate={watchStartDate}
                  endDate={watchEndDate}
                  availabilityWarnings={availabilityWarnings}
                  periodAvailability={periodAvailability}
                  hasSelectedPeriod={hasSelectedPeriod}
                  hasItems={hasItems}
                  subtotal={subtotal}
                  originalSubtotal={originalSubtotal}
                  totalSavings={totalSavings}
                  deposit={deposit}
                  addProduct={addProduct}
                  updateQuantity={updateQuantity}
                  updateSelectedAttributes={updateSelectedAttributes}
                  removeSelectedProductLine={removeSelectedProductLine}
                  onAddCustomItem={() => openCustomItemDialog(null)}
                  onEditCustomItem={openCustomItemDialog}
                  updateCustomItemQuantity={updateCustomItemQuantity}
                  removeCustomItem={removeCustomItem}
                  onTulipInsuranceOptInChange={setTulipInsuranceOptIn}
                  openPriceOverrideDialog={openPriceOverrideDialog}
                  calculateDurationForMode={calculateDurationForMode}
                  getProductPricingDetails={getProductPricingDetails}
                  getCustomItemTotal={getCustomItemTotal}
                />
              </div>

              {isDeliveryEnabled && deliverySettings && (
                <div id="section-delivery" className="scroll-mt-8">
                  <NewReservationStepDelivery
                    deliverySettings={deliverySettings}
                    subtotal={subtotal + tulipInsuranceAmount}
                    currency="EUR"
                    storeAddress={storeAddress}
                    locations={storeLocations}
                    isDeliveryForced={delivery.isDeliveryForced}
                    isDeliveryIncluded={delivery.isDeliveryIncluded}
                    outboundMethod={delivery.outboundMethod}
                    pickupLocationId={delivery.pickupLocationId}
                    outboundAddress={delivery.outboundAddress}
                    outboundDistance={delivery.outboundDistance}
                    outboundFee={delivery.outboundFee}
                    outboundError={delivery.outboundError}
                    onOutboundMethodChange={delivery.handleOutboundMethodChange}
                    onPickupLocationChange={delivery.handlePickupLocationChange}
                    onOutboundAddressChange={delivery.handleOutboundAddressChange}
                    returnMethod={delivery.returnMethod}
                    returnLocationId={delivery.returnLocationId}
                    returnAddress={delivery.returnAddress}
                    returnDistance={delivery.returnDistance}
                    returnFee={delivery.returnFee}
                    returnError={delivery.returnError}
                    onReturnMethodChange={delivery.handleReturnMethodChange}
                    onReturnLocationChange={delivery.handleReturnLocationChange}
                    onReturnAddressChange={delivery.handleReturnAddressChange}
                    totalFee={delivery.totalFee}
                  />
                </div>
              )}

              <NewReservationPartnerCard partnerId={partnerId} onChange={setPartnerId} />

              <div id="section-notes" className="scroll-mt-8">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("internalNotes")}</CardTitle>
                    <CardDescription>{t("notesHint")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form.AppField name="internalNotes">
                      {(field) => (
                        <field.Textarea
                          placeholder={t("notesPlaceholder")}
                          className="min-h-30 resize-none"
                        />
                      )}
                    </form.AppField>
                  </CardContent>
                </Card>
              </div>
            </div>

            <aside className="w-full shrink-0 lg:sticky lg:top-16 lg:w-80 xl:w-88">
              <NewReservationSummaryPanel
                selectedCustomer={selectedCustomer}
                isNewCustomer={isNewCustomer}
                startDate={watchStartDate}
                endDate={watchEndDate}
                duration={duration}
                detailedDuration={detailedDuration}
                timezone={timezone}
                itemCount={selectedProducts.length + customItems.length}
                isDeliveryEnabled={isDeliveryEnabled}
                isDeliveryReady={delivery.canContinue}
                subtotal={subtotal}
                tulipInsuranceAmount={tulipInsuranceAmount}
                isTulipInsuranceQuoteLoading={isTulipInsuranceQuoteLoading}
                deliveryFee={delivery.totalFee}
                total={total}
                taxDisplay={taxDisplay}
                deposit={deposit}
                discount={globalDiscount}
                discountAmount={globalDiscountAmount}
                onDiscountChange={setGlobalDiscount}
                depositOverride={depositOverride}
                onDepositOverrideChange={setDepositOverride}
                sendConfirmationEmail={sendConfirmationEmail}
                onSendConfirmationEmailChange={setSendConfirmationEmail}
                onNavigateToSection={scrollToSection}
              />
            </aside>
          </div>

          {/* Actions */}
          <StepActions>
            <div>
              {/* No cancel on the phone: the breadcrumb and the back gesture
                  already cover leaving — the bar is for the two real decisions.
                  The empty wrapper keeps justify-between pushing them right. */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="max-sm:hidden"
                onClick={() => router.push("/dashboard/reservations")}
              >
                {tCommon("cancel")}
              </Button>
            </div>

            {/* With the cancel gone on the phone, the two decisions share the
                whole bar — flex-1 with a zero basis splits it evenly. */}
            <div className="flex min-w-0 items-center gap-3 max-sm:flex-1 max-sm:gap-2">
              <Button
                type="submit"
                variant="outline"
                size="lg"
                isPending={isSaving && sendAsQuoteRef.current}
                disabled={isSaving}
                onClick={() => {
                  sendAsQuoteRef.current = true;
                }}
                className="max-sm:flex-1 max-sm:px-4"
              >
                <FileText data-slot="icon" className="max-sm:hidden" />
                {t("sendAsQuote")}
              </Button>
              <Button
                type="submit"
                size="lg"
                isPending={isSaving && !sendAsQuoteRef.current}
                disabled={isSaving}
                onClick={() => {
                  sendAsQuoteRef.current = false;
                }}
                className="max-sm:flex-1 max-sm:px-4"
              >
                <Check data-slot="icon" className="max-sm:hidden" />
                {t("create")}
              </Button>
            </div>
          </StepActions>
        </form.Form>
      </form.AppForm>

      <NewReservationConfirmDrawer
        open={confirmDrawer.isOpen}
        onOpenChange={(open) => setConfirmDrawer((current) => ({ ...current, isOpen: open }))}
        asQuote={confirmDrawer.asQuote}
        isSubmitting={isSaving}
        onConfirm={handleConfirmDrawerSubmit}
        customer={selectedCustomer}
        isNewCustomer={isNewCustomer}
        startDate={watchStartDate}
        endDate={watchEndDate}
        durationLabel={durationLabel}
        timezone={timezone}
        itemLines={recapItemLines}
        outboundLeg={recapOutboundLeg}
        returnLeg={recapReturnLeg}
        subtotal={subtotal}
        tulipInsuranceAmount={tulipInsuranceAmount}
        deliveryFee={delivery.totalFee}
        discountAmount={globalDiscountAmount}
        deposit={effectiveDeposit}
        total={total}
        taxDisplay={taxDisplay}
        willSendConfirmationEmail={confirmDrawer.asQuote || sendConfirmationEmail}
        periodWarnings={periodWarnings}
        availabilityWarnings={availabilityWarnings}
      />

      <NewReservationCustomItemDialog
        key={customItemDialog.session}
        open={customItemDialog.open}
        onOpenChange={(open) => setCustomItemDialog((current) => ({ ...current, open }))}
        item={customItemDialog.item}
        startDate={watchStartDate}
        endDate={watchEndDate}
        calculateDurationForMode={calculateDurationForMode}
        currency={currency}
        onSave={saveCustomItem}
      />

      {/* Price Override Dialog */}
      <Dialog
        open={priceOverrideDialog.isOpen}
        onOpenChange={(open) => !open && closePriceOverrideDialog()}
      >
        <DialogPopup className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t("priceOverride.dialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("priceOverride.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              {/* Display calculated price for reference */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("priceOverride.calculatedPrice")}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(priceOverrideDialog.currentPrice)}/
                    {getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                  </span>
                </div>
              </div>

              {/* Edit mode: unit price, total for the period, or discount % */}
              <Tabs
                value={priceOverrideDialog.mode}
                onValueChange={(value) => setPriceOverrideMode(value as PriceOverrideMode)}
              >
                <TabsList className="w-full *:flex-1">
                  <TabsTrigger value="unit">{t("priceOverride.modeUnit")}</TabsTrigger>
                  <TabsTrigger value="total">{t("priceOverride.modeTotal")}</TabsTrigger>
                  <TabsTrigger value="percent">{t("priceOverride.modePercent")}</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Value input */}
              <div className="space-y-2">
                <Label htmlFor="override-price">{t("priceOverride.newPrice")} *</Label>
                <InputPrice
                  value={priceOverrideDialog.value ?? 0}
                  displayEmpty={priceOverrideDialog.value == null}
                  onValueCommitted={(value) =>
                    setPriceOverrideDialog((current) => ({ ...current, value }))
                  }
                  onEmptyCommitted={() =>
                    setPriceOverrideDialog((current) => ({ ...current, value: null }))
                  }
                  placeholder={t("priceOverride.newPricePlaceholder")}
                  suffix={
                    priceOverrideDialog.mode === "unit"
                      ? `€/${getPricingUnitLabel(priceOverrideDialog.pricingMode)}`
                      : priceOverrideDialog.mode === "total"
                        ? "€"
                        : "%"
                  }
                  ariaLabel={t("priceOverride.newPrice")}
                  className="w-full"
                />
              </div>

              {/* Live preview: resulting unit price + total, delta vs calculated */}
              {resolvedOverrideUnitPrice != null && priceOverrideDialog.duration > 0 && (
                <div className="space-y-1 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("priceOverride.resultingUnitPrice")}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(resolvedOverrideUnitPrice)}/
                      {getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("priceOverride.totalForPeriod")}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(resolvedOverrideUnitPrice * priceOverrideDivisor)}
                    </span>
                  </div>
                  {Math.abs(resolvedOverrideUnitPrice - priceOverrideDialog.currentPrice) >=
                    0.005 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        vs.{" "}
                        {formatCurrency(priceOverrideDialog.currentPrice * priceOverrideDivisor)}
                      </span>
                      <span
                        className={cn(
                          resolvedOverrideUnitPrice < priceOverrideDialog.currentPrice
                            ? "text-green-600"
                            : "text-orange-600",
                        )}
                      >
                        {resolvedOverrideUnitPrice < priceOverrideDialog.currentPrice ? "-" : "+"}
                        {formatCurrency(
                          Math.abs(resolvedOverrideUnitPrice - priceOverrideDialog.currentPrice) *
                            priceOverrideDivisor,
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogPanel>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={resetPriceOverride}
              className="sm:mr-auto"
            >
              {t("priceOverride.reset")}
            </Button>
            <Button type="button" variant="outline" onClick={closePriceOverrideDialog}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" onClick={applyPriceOverride}>
              {t("priceOverride.apply")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <ReservationOverbookingDialog
        open={overbookingDialog.isOpen}
        onOpenChange={(open) => setOverbookingDialog((current) => ({ ...current, isOpen: open }))}
        shortfalls={overbookingDialog.shortfalls}
        intent="create"
        isPending={isSaving}
        onConfirm={async () => {
          posthog.capture(productAnalyticsEvents.dashboardReservationOverbookingConfirmed, {
            ...dashboardReservationAnalyticsBaseProperties,
            shortfall_count: overbookingDialog.shortfalls.length,
            source: openReplaySource,
          });
          setOverbookingDialog({ isOpen: false, shortfalls: [] });
          await submitManualReservation(watchedValues, {
            allowOverbooking: true,
          });
        }}
      />

      <ReservationGateDialog open={gateDialogOpen} onOpenChange={setGateDialogOpen} />
    </>
  );
}
