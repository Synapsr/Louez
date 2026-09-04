"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { format } from "date-fns";
import {
  CalendarRange,
  Check,
  Copy,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormatLocale } from "@/hooks/use-format-locale";

import type { PricingKind, PricingMode, Rate, TaxSettings } from "@louez/types";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toastManager,
} from "@louez/ui";
import { PricingIcon } from "@louez/ui/icons";
import { minutesToPriceDuration, priceDurationToMinutes } from "@louez/utils";

import {
  CHART_RANGE_PRESETS,
  type ChartRangePreset,
  PricingChart,
  RatesEditor,
  SHOW_DEV_CHART_RANGE_SELECTOR,
  buildChartData,
  buildChartTicks,
  resolveChartMaxMinutes,
} from "@/components/dashboard/rates-editor";
import { PriceDurationInput, type PriceDurationValue } from "@/components/ui/price-duration-input";

import { getFieldError } from "@/hooks/form/form-context";

import {
  deleteSeasonalPricing,
  duplicateSeasonalPricing,
  updateSeasonalPricing,
} from "../seasonal-actions";
import type {
  AvailableAccessory,
  ProductFormComponentApi,
  ProductFormValues,
  RateTierInput,
  SeasonalPricingData,
} from "../types";
import { PricingPeriodSelector } from "./pricing-period-selector";
import { ProductFormSectionAccessories } from "./product-form-section-accessories";
import { ProductFormSectionStock } from "./product-form-section-stock";
import { SeasonalPeriodFormDialog } from "./seasonal-period-form-dialog";

interface ProductFormStepPricingProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  currency: string;
  currencySymbol: string;
  isSaving: boolean;
  duplicateRateTierIndexes?: number[];
  onRateTiersEdit?: () => void;
  storeTaxSettings?: TaxSettings;
  availableAccessories: AvailableAccessory[];
  showAccessories: boolean;
  showStock?: boolean;
  showValidationErrors?: boolean;
  showUnitValidationErrors?: boolean;
  // Seasonal pricing props (optional - only passed in edit mode)
  productId?: string;
  seasonalPricings?: SeasonalPricingData[];
  selectedSeasonalPeriodId?: string | null;
  onSelectSeasonalPeriod?: (id: string | null) => void;
  onSeasonalPricingsChange?: (pricings: SeasonalPricingData[]) => void;
  isLoadingSeasonalPricings?: boolean;
}

function toLegacyPricingMode(unit: PriceDurationValue["unit"]): PricingMode {
  if (unit === "week") return "week";
  if (unit === "day") return "day";
  return "hour";
}

/** Base UI radio groups hand back an `unknown` value; narrow it here. */
function toPricingKind(value: unknown): PricingKind {
  return value === "fixed" ? "fixed" : "duration";
}

function hasValidBaseRate(value: PriceDurationValue | undefined): boolean {
  if (!value) return false;
  if (value.duration < 1) return false;
  const normalizedPrice = value.price.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalizedPrice)) return false;
  return Number.parseFloat(normalizedPrice) > 0;
}

function toFormTiers(tiers: SeasonalPricingData["tiers"]): RateTierInput[] {
  return tiers
    .filter((t) => t.period !== null && t.price !== null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((t) => {
      const { duration, unit } = minutesToPriceDuration(t.period!);
      return {
        id: t.id,
        price: t.price!,
        duration,
        unit,
      };
    });
}

export function ProductFormStepPricing({
  form,
  watchedValues,
  currency,
  currencySymbol,
  isSaving,
  duplicateRateTierIndexes = [],
  onRateTiersEdit,
  storeTaxSettings,
  availableAccessories,
  showAccessories,
  showStock = true,
  showValidationErrors = false,
  showUnitValidationErrors = false,
  // Seasonal props
  productId,
  seasonalPricings = [],
  selectedSeasonalPeriodId = null,
  onSelectSeasonalPeriod,
  onSeasonalPricingsChange,
  isLoadingSeasonalPricings = false,
}: ProductFormStepPricingProps) {
  const t = useTranslations("dashboard.products.form");
  const tValidation = useTranslations("validation");
  const { dateFns: calendarLocale } = useFormatLocale();
  const [highlightBaseRate, setHighlightBaseRate] = useState(false);

  // Seasonal inline editing state
  const [seasonalPriceDuration, setSeasonalPriceDuration] = useState<
    PriceDurationValue | undefined
  >();
  const [seasonalRateTiers, setSeasonalRateTiers] = useState<RateTierInput[]>([]);
  const [seasonalDirty, setSeasonalDirty] = useState(false);
  const [isSavingSeasonal, startSeasonalTransition] = useTransition();
  const [seasonalChartRangePreset, setSeasonalChartRangePreset] =
    useState<ChartRangePreset>("auto");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // A fixed price never varies with the season, so seasonal editing stays out
  // of reach while that mode is on — without discarding the stored periods.
  const isFixedPricing = watchedValues.pricingKind === "fixed";

  // Track the previous period id to detect changes and auto-save
  const isSeasonalMode = !isFixedPricing && selectedSeasonalPeriodId !== null;
  const selectedPeriod = isSeasonalMode
    ? (seasonalPricings.find((sp) => sp.id === selectedSeasonalPeriodId) ?? null)
    : null;

  // Load seasonal data into local state when period changes
  useEffect(() => {
    if (!selectedPeriod) return;
    setSeasonalPriceDuration({
      price: selectedPeriod.price,
      duration: watchedValues.basePriceDuration?.duration ?? 1,
      unit: watchedValues.basePriceDuration?.unit ?? "day",
    });
    setSeasonalRateTiers(toFormTiers(selectedPeriod.tiers));
    setSeasonalDirty(false);
  }, [selectedPeriod?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save when switching periods
  const saveCurrentSeasonalPricing = useCallback(
    async (periodId: string) => {
      const period = seasonalPricings.find((sp) => sp.id === periodId);
      if (!period || !seasonalPriceDuration) return;

      const payload = {
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        price: seasonalPriceDuration.price.replace(",", "."),
        rateTiers: seasonalRateTiers.map((tier) => ({
          price: tier.price.replace(",", "."),
          duration: tier.duration,
          unit: tier.unit,
        })),
      };

      const result = await updateSeasonalPricing(periodId, payload);
      if (result && "error" in result) {
        toastManager.add({
          title: t(result.error as any) || result.error,
          type: "error",
        });
        return false;
      }
      return true;
    },
    [seasonalPriceDuration, seasonalRateTiers, seasonalPricings, t],
  );

  // Debounced auto-save: triggers 1.5s after the last edit
  useEffect(() => {
    if (!seasonalDirty || !selectedSeasonalPeriodId) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const success = await saveCurrentSeasonalPricing(selectedSeasonalPeriodId);
      if (success) {
        setSeasonalDirty(false);
        setAutoSaveStatus("saved");
        // Update the price in the list (for the period selector badge)
        if (onSeasonalPricingsChange && seasonalPriceDuration) {
          const updated = seasonalPricings.map((sp) => {
            if (sp.id !== selectedSeasonalPeriodId) return sp;
            return {
              ...sp,
              price: seasonalPriceDuration.price.replace(",", "."),
            };
          });
          onSeasonalPricingsChange(updated);
        }
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
      } else {
        setAutoSaveStatus("idle");
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [seasonalDirty, seasonalPriceDuration, seasonalRateTiers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save immediately when switching periods
  const handleSelectPeriod = useCallback(
    async (newPeriodId: string | null) => {
      // Clear any pending debounce timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      // Auto-save current period if dirty
      if (seasonalDirty && selectedSeasonalPeriodId) {
        await saveCurrentSeasonalPricing(selectedSeasonalPeriodId);
        if (onSeasonalPricingsChange && seasonalPriceDuration) {
          const updated = seasonalPricings.map((sp) => {
            if (sp.id !== selectedSeasonalPeriodId) return sp;
            return {
              ...sp,
              price: seasonalPriceDuration.price.replace(",", "."),
            };
          });
          onSeasonalPricingsChange(updated);
        }
      }
      setAutoSaveStatus("idle");
      onSelectSeasonalPeriod?.(newPeriodId);
    },
    [
      seasonalDirty,
      selectedSeasonalPeriodId,
      saveCurrentSeasonalPricing,
      onSelectSeasonalPeriod,
      onSeasonalPricingsChange,
      seasonalPriceDuration,
      seasonalPricings,
    ],
  );

  const handleAddPeriod = () => {
    setEditingMetadata(null);
    setDialogOpen(true);
  };

  const handleEditMetadata = () => {
    if (!selectedPeriod) return;
    setEditingMetadata({
      id: selectedPeriod.id,
      name: selectedPeriod.name,
      startDate: selectedPeriod.startDate,
      endDate: selectedPeriod.endDate,
    });
    setDialogOpen(true);
  };

  const handlePeriodCreated = (newPeriod: SeasonalPricingData) => {
    const updated = [...seasonalPricings, newPeriod].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    onSeasonalPricingsChange?.(updated);
    onSelectSeasonalPeriod?.(newPeriod.id);
  };

  const handleMetadataUpdated = async (
    id: string,
    name: string,
    startDate: string,
    endDate: string,
  ) => {
    // Get current pricing data for the period
    const period = seasonalPricings.find((sp) => sp.id === id);
    if (!period) return;

    // Use local state values if this is the currently selected period, otherwise use stored values
    const currentPrice =
      id === selectedSeasonalPeriodId && seasonalPriceDuration
        ? seasonalPriceDuration.price.replace(",", ".")
        : period.price;
    const currentTiers =
      id === selectedSeasonalPeriodId ? seasonalRateTiers : toFormTiers(period.tiers);

    const payload = {
      name,
      startDate,
      endDate,
      price: currentPrice,
      rateTiers: currentTiers.map((tier) => ({
        price: tier.price.replace(",", "."),
        duration: tier.duration,
        unit: tier.unit,
      })),
    };

    const result = await updateSeasonalPricing(id, payload);
    if (result && "error" in result) {
      toastManager.add({
        title: t(result.error as any) || result.error,
        type: "error",
      });
      return;
    }

    toastManager.add({ title: t("periodSaved"), type: "success" });
    const updated = seasonalPricings
      .map((sp) => {
        if (sp.id !== id) return sp;
        return { ...sp, name, startDate, endDate, price: currentPrice };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    onSeasonalPricingsChange?.(updated);
    setSeasonalDirty(false);
  };

  const handleDeletePeriod = async () => {
    if (!selectedPeriod) return;
    startSeasonalTransition(async () => {
      const result = await deleteSeasonalPricing(selectedPeriod.id);
      if (result && "error" in result) {
        toastManager.add({
          title: t(result.error as any) || result.error,
          type: "error",
        });
        return;
      }
      const updated = seasonalPricings.filter((sp) => sp.id !== selectedPeriod.id);
      onSeasonalPricingsChange?.(updated);
      onSelectSeasonalPeriod?.(null);
      setDeleteDialogOpen(false);
    });
  };

  const handleDuplicatePeriod = async () => {
    if (!selectedPeriod) return;
    // Auto-save first if dirty
    if (seasonalDirty) {
      await saveCurrentSeasonalPricing(selectedPeriod.id);
    }
    startSeasonalTransition(async () => {
      const result = await duplicateSeasonalPricing(selectedPeriod.id);
      if (result && "error" in result) {
        toastManager.add({
          title: t(result.error as any) || result.error,
          type: "error",
        });
        return;
      }
      if (result && "id" in result) {
        // Reload by refetching - parent will handle this
        // For now, add a placeholder and select it
        toastManager.add({ title: t("seasonDuplicated"), type: "success" });
        // We need to reload the full list since we don't have the duplicated data
        // Signal the parent to reload
        onSeasonalPricingsChange?.([]);
        onSelectSeasonalPeriod?.(result.id);
      }
    });
  };

  // Chart data for the currently edited seasonal period
  const tCommon = useTranslations("common");
  const seasonalValidRates: Rate[] = useMemo(
    () =>
      seasonalRateTiers
        .map((tier, index) => ({
          id: tier.id ?? `seasonal-${index}`,
          price: Number.parseFloat(tier.price.replace(",", ".")) || 0,
          period: priceDurationToMinutes(tier.duration, tier.unit),
          displayOrder: index,
        }))
        .filter((r) => r.price > 0 && r.period > 0),
    [seasonalRateTiers],
  );

  const seasonalBasePeriod = seasonalPriceDuration
    ? priceDurationToMinutes(seasonalPriceDuration.duration, seasonalPriceDuration.unit)
    : 0;
  const seasonalBasePrice = seasonalPriceDuration
    ? Number.parseFloat(seasonalPriceDuration.price.replace(",", ".")) || 0
    : 0;
  const seasonalChartMaxMinutes = useMemo(
    () => resolveChartMaxMinutes(seasonalChartRangePreset),
    [seasonalChartRangePreset],
  );

  const seasonalChartData = useMemo(
    () =>
      buildChartData(
        seasonalBasePrice,
        seasonalBasePeriod,
        seasonalValidRates,
        tCommon,
        seasonalChartMaxMinutes,
      ),
    [seasonalBasePrice, seasonalBasePeriod, seasonalValidRates, tCommon, seasonalChartMaxMinutes],
  );

  const seasonalChartAnchorTicks = useMemo(
    () => buildChartTicks(seasonalChartData),
    [seasonalChartData],
  );

  // Seasonal banner for when a period is selected
  const seasonalBanner = selectedPeriod ? (
    <div className="border-primary/20 bg-primary/5 flex items-start gap-3 rounded-lg border p-3">
      <CalendarRange className="text-primary mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{selectedPeriod.name}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {format(new Date(selectedPeriod.startDate + "T00:00:00"), "d MMM yyyy", {
            locale: calendarLocale,
          })}
          {" → "}
          {format(new Date(selectedPeriod.endDate + "T00:00:00"), "d MMM yyyy", {
            locale: calendarLocale,
          })}
        </p>
      </div>
      {autoSaveStatus !== "idle" && (
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          {autoSaveStatus === "saving" && (
            <>
              <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
              <span className="text-muted-foreground text-xs">{t("savingPeriod")}</span>
            </>
          )}
          {autoSaveStatus === "saved" && (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-xs text-emerald-600">{t("periodSaved")}</span>
            </>
          )}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleEditMetadata}
        >
          <Pencil className="h-3 w-3" />
          {t("editPeriodMetadata")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" />}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDuplicatePeriod}>
              <Copy className="mr-2 h-4 w-4" />
              {t("duplicateSeason")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("deleteSeason")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  ) : null;

  const pricingKindOptions: Array<{ value: PricingKind; label: string }> = [
    { value: "duration", label: t("pricingKindDuration") },
    { value: "fixed", label: t("pricingKindFixed") },
  ];

  const pricingCard = (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PricingIcon className="h-5 w-5 shrink-0" />
              {t("pricing")}
            </CardTitle>
            <CardDescription className="mt-1.5">{t("pricingDescription")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Pricing kind: a once-made choice, kept compact in the header */}
            <form.Field name="pricingKind">
              {(field) => (
                <Select
                  value={field.state.value ?? "duration"}
                  onValueChange={(value) => {
                    const nextKind = toPricingKind(value);
                    field.handleChange(nextKind);
                    // Only a flat rate can carry consumable stock; dropping
                    // back to duration pricing has to release that choice too,
                    // otherwise the form would submit a state the server
                    // rejects.
                    if (nextKind !== "fixed" && watchedValues.stockKind === "consumable") {
                      form.setFieldValue("stockKind", "returnable");
                    }
                  }}
                  disabled={isSaving || isSeasonalMode}
                >
                  <SelectTrigger
                    className="h-8 w-auto min-w-36"
                    aria-label={t("pricingKindLabel")}
                  >
                    <SelectValue>
                      {
                        pricingKindOptions.find(
                          (option) => option.value === (field.state.value ?? "duration"),
                        )?.label
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {pricingKindOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        label={option.label}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </form.Field>
            {productId && !isFixedPricing && (
              <PricingPeriodSelector
                selectedPeriodId={selectedSeasonalPeriodId}
                seasonalPricings={seasonalPricings}
                basePriceValue={watchedValues.basePriceDuration?.price}
                onSelectPeriod={handleSelectPeriod}
                onAddPeriod={handleAddPeriod}
                isLoading={isLoadingSeasonalPricings}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Seasonal mode: banner + inline price/tiers editing */}
        {isSeasonalMode && selectedPeriod ? (
          <>
            {seasonalBanner}
            {/* Seasonal base price */}
            <div className="space-y-2">
              <Label>{t("seasonBasePrice")}</Label>
              <PriceDurationInput
                value={
                  seasonalPriceDuration ?? {
                    price: "",
                    duration: 1,
                    unit: "day",
                  }
                }
                onChange={(next) => {
                  setSeasonalPriceDuration(next);
                  setSeasonalDirty(true);
                }}
                currency={currency}
                disabled={isSaving || isSavingSeasonal}
              />
              <p className="text-muted-foreground text-xs">{t("seasonBasePriceHint")}</p>
            </div>
            {/* Seasonal rate tiers */}
            <RatesEditor
              basePriceDuration={seasonalPriceDuration}
              rates={seasonalRateTiers}
              onChange={(next) => {
                setSeasonalRateTiers(next);
                setSeasonalDirty(true);
              }}
              enforceStrictTiers={false}
              onEnforceStrictTiersChange={() => {}}
              currency={currency}
              disabled={isSaving || isSavingSeasonal}
              hideProgressiveToggle
            />
            {/* Seasonal pricing curve preview (only meaningful with at least one tier) */}
            {seasonalValidRates.length > 0 && seasonalChartData.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <PricingChart
                  data={seasonalChartData}
                  anchorTicks={seasonalChartAnchorTicks}
                  isProgressive={!(watchedValues.enforceStrictTiers ?? true)}
                  gradientId="seasonal"
                  currency={currency}
                  tCommon={tCommon}
                  t={t}
                  headerAddon={
                    SHOW_DEV_CHART_RANGE_SELECTOR ? (
                      <Select
                        value={seasonalChartRangePreset}
                        onValueChange={(value) =>
                          setSeasonalChartRangePreset(value as ChartRangePreset)
                        }
                      >
                        <SelectTrigger className="h-8 w-[90px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHART_RANGE_PRESETS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null
                  }
                />
              </div>
            )}
            {/* Hint to go back to base pricing for TVA/deposit/progressive */}
            <div className="border-muted bg-muted/30 flex items-start gap-2.5 rounded-lg border px-3.5 py-3">
              <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-muted-foreground flex-1 text-sm">
                <span>{t("seasonalSettingsHint")}</span>{" "}
                <button
                  type="button"
                  className="text-primary inline font-medium underline-offset-2 hover:underline"
                  onClick={() => onSelectSeasonalPeriod?.(null)}
                >
                  {t("switchToBasePricing")}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Fixed pricing: one flat amount, no period, tiers or curve */}
            {isFixedPricing ? (
              <div className="space-y-2">
                <Label htmlFor="price" helper={t("fixedPriceDescription")}>
                  {t("fixedPrice")}
                </Label>
                <div className="w-44">
                  <form.AppField name="price">
                    {(field) => (
                      <field.Input suffix={currencySymbol} placeholder={t("pricePlaceholder")} />
                    )}
                  </form.AppField>
                </div>
              </div>
            ) : (
              <>
                {/* Base pricing mode: original content */}
                <form.Field name="basePriceDuration">
                  {(field) => {
                    const fallbackBaseRate: PriceDurationValue = {
                      price: watchedValues.price || "",
                      duration: 1,
                      unit:
                        watchedValues.pricingMode === "week"
                          ? "week"
                          : watchedValues.pricingMode === "hour"
                            ? "hour"
                            : "day",
                    };
                    const baseRateValue = field.state.value ?? fallbackBaseRate;
                    const showBaseRateHighlight =
                      (highlightBaseRate ||
                        showValidationErrors ||
                        field.state.meta.errors.length > 0) &&
                      !hasValidBaseRate(baseRateValue);
                    const baseRateError =
                      field.state.meta.errors.length > 0
                        ? getFieldError(field.state.meta.errors[0])
                        : showBaseRateHighlight
                          ? tValidation("positive")
                          : null;

                    return (
                      <div className="space-y-2">
                        <Label helper={t("baseRateDescription")}>{t("baseRate")}</Label>
                        <PriceDurationInput
                          value={baseRateValue}
                          onChange={(next) => {
                            field.handleChange(next);
                            form.setFieldValue("price", next.price);
                            form.setFieldValue("pricingMode", toLegacyPricingMode(next.unit));
                            if (highlightBaseRate && hasValidBaseRate(next)) {
                              setHighlightBaseRate(false);
                            }
                          }}
                          currency={currency}
                          disabled={isSaving}
                          invalid={showBaseRateHighlight}
                        />
                        {baseRateError ? (
                          <p className="text-destructive text-sm font-medium">{baseRateError}</p>
                        ) : null}
                      </div>
                    );
                  }}
                </form.Field>
                <form.Field name="rateTiers">
                  {(field) => (
                    <div>
                      <RatesEditor
                        basePriceDuration={watchedValues.basePriceDuration}
                        rates={field.state.value || []}
                        onChange={(next) => {
                          field.handleChange(next);
                          onRateTiersEdit?.();
                        }}
                        enforceStrictTiers={watchedValues.enforceStrictTiers ?? true}
                        onEnforceStrictTiersChange={(value) =>
                          form.setFieldValue("enforceStrictTiers", value)
                        }
                        onRequireBaseRate={() => setHighlightBaseRate(true)}
                        invalidRateIndexes={duplicateRateTierIndexes}
                        currency={currency}
                        disabled={isSaving}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm font-medium">
                          {getFieldError(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              </>
            )}
            {storeTaxSettings?.enabled && (
              <>
                <Separator />
                <div className="space-y-4">
                  <form.AppField name="taxSettings.inheritFromStore">
                    {(field) => (
                      <field.Switch
                        label={t("inheritTax")}
                        description={t("inheritTaxDescription", {
                          rate: storeTaxSettings.defaultRate,
                        })}
                      />
                    )}
                  </form.AppField>

                  {!watchedValues.taxSettings?.inheritFromStore && (
                    <form.Field name="taxSettings.customRate">
                      {(field) => (
                        <div className="space-y-2">
                          <Label>{t("customTaxRate")}</Label>
                          <div className="relative w-32">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              placeholder="20"
                              className="pr-8"
                              value={field.state.value ?? ""}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.value ? parseFloat(event.target.value) : undefined,
                                )
                              }
                              onBlur={field.handleBlur}
                            />
                            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
                              %
                            </span>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            {t("customTaxRateDescription")}
                          </p>
                          {field.state.meta.errors.length > 0 && (
                            <p className="text-destructive text-sm font-medium">
                              {getFieldError(field.state.meta.errors[0])}
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                  )}
                </div>
              </>
            )}
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="deposit" helper={t("depositHelp")}>
                {t("deposit")}
              </Label>
              <div className="w-44">
                <form.AppField name="deposit">
                  {(field) => (
                    <field.Input suffix={currencySymbol} placeholder={t("depositPlaceholder")} />
                  )}
                </form.AppField>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Seasonal period form dialog */}
      {productId && (
        <SeasonalPeriodFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          productId={productId}
          editingData={editingMetadata}
          basePriceDuration={watchedValues.basePriceDuration}
          baseRateTiers={watchedValues.rateTiers || []}
          onCreated={handlePeriodCreated}
          onUpdated={handleMetadataUpdated}
        />
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteSeasonTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteSeasonDescription", {
                name: selectedPeriod?.name || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{t("cancel")}</AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  onClick={handleDeletePeriod}
                  disabled={isSavingSeasonal}
                />
              }
            >
              {t("deleteSeason")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );

  const stockCard = (
    <ProductFormSectionStock
      form={form}
      watchedValues={watchedValues}
      currency={currency}
      disabled={isSaving}
      showValidationErrors={showUnitValidationErrors}
    />
  );

  const accessoriesCard = (
    <ProductFormSectionAccessories
      form={form}
      availableAccessories={availableAccessories}
      currency={currency}
      disabled={isSaving}
    />
  );

  // Pricing-only mode (edit mode renders stock/accessories as separate sections)
  if (!showStock && !showAccessories) {
    return pricingCard;
  }

  // Full step mode (create stepper): pricing + stock in a grid, optionally accessories
  if (showAccessories) {
    return (
      <>
        <div className="grid gap-6">
          {pricingCard}
          {stockCard}
        </div>
        {accessoriesCard}
      </>
    );
  }

  return (
    <div className="grid gap-6">
      {pricingCard}
      {stockCard}
    </div>
  );
}
