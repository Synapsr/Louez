"use client";

/**
 * The pricing section of the product form: base rates, one season's rates, or a
 * flat fee. Composition mirrors the rest of the step — pricing sits beside the
 * stock card, with accessories underneath when the create flow asks for them.
 */

import { useCallback, useState } from "react";

import { format } from "date-fns";
import { useTranslations } from "next-intl";

import {
  Badge,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";

import type { PricingKind, TaxSettings } from "@louez/types";

import { useFormatLocale } from "@/hooks/use-format-locale";

import { updateSeasonalPricing } from "../seasonal-actions";
import type {
  AvailableAccessory,
  ProductFormComponentApi,
  ProductFormValues,
  SeasonalPricingData,
} from "../types";
import { ProductPromotionField } from "./product-promotion-field";
import { PricingLadder } from "./pricing-ladder";
import { PricingPeriodSelector } from "./pricing-period-selector";
import { SeasonalActionsMenu, SeasonalSaveIndicator } from "./pricing-season-actions";
import { ProductFormSectionAccessories } from "./product-form-section-accessories";
import { ProductFormSectionStock } from "./product-form-section-stock";
import { SeasonalPeriodFormDialog } from "./seasonal-period-form-dialog";
import { usePricingDraft } from "./use-pricing-draft";
import { toStoredTiers, useSeasonalPricingDraft } from "./use-seasonal-pricing-draft";

interface PricingStepProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  currency: string;
  currencySymbol: string;
  isSaving: boolean;
  storeTaxSettings?: TaxSettings;
  storeTimezone?: string;
  availableAccessories: AvailableAccessory[];
  showAccessories: boolean;
  showStock?: boolean;
  showValidationErrors?: boolean;
  showUnitValidationErrors?: boolean;
  /** Rows the server rejected as duplicate durations, flagged on submit. */
  duplicateRateTierIndexes?: number[];
  /** Lets the form clear those server-side errors as soon as rates are edited. */
  onRateTiersEdit?: () => void;
  /** Seasonal props — only passed in edit mode, where a product id exists. */
  productId?: string;
  seasonalPricings?: SeasonalPricingData[];
  selectedSeasonalPeriodId?: string | null;
  onSelectSeasonalPeriod?: (id: string | null) => void;
  onSeasonalPricingsChange?: (pricings: SeasonalPricingData[]) => void;
  isLoadingSeasonalPricings?: boolean;
}

/** The create stepper shows pricing beside stock (and accessories below); the
 *  edit page renders those as separate sections and asks for pricing alone. */
export function ProductFormStepPricing(props: PricingStepProps) {
  const { showStock = true, showAccessories } = props;
  const card = <PricingCard {...props} />;

  if (!showStock && !showAccessories) return card;

  const stock = (
    <ProductFormSectionStock
      form={props.form}
      watchedValues={props.watchedValues}
      currency={props.currency}
      disabled={props.isSaving}
      showValidationErrors={props.showUnitValidationErrors}
    />
  );

  if (!showAccessories) {
    return (
      <div className="grid gap-6">
        {card}
        {stock}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6">
        {card}
        {stock}
      </div>
      <ProductFormSectionAccessories
        form={props.form}
        availableAccessories={props.availableAccessories}
        currency={props.currency}
        disabled={props.isSaving}
      />
    </>
  );
}

function PricingCard(props: PricingStepProps) {
  const {
    form,
    watchedValues,
    currency,
    currencySymbol,
    isSaving,
    storeTaxSettings,
    storeTimezone,
    productId,
    seasonalPricings = [],
    selectedSeasonalPeriodId = null,
    onSelectSeasonalPeriod,
    onSeasonalPricingsChange,
    isLoadingSeasonalPricings = false,
    showValidationErrors = false,
    duplicateRateTierIndexes,
    onRateTiersEdit,
  } = props;

  const t = useTranslations("dashboard.products.form");
  const { dateFns: dateLocale } = useFormatLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<SeasonalPricingData | null>(null);

  const baseDraft = usePricingDraft(form, watchedValues, onRateTiersEdit);
  const selectedPeriod =
    seasonalPricings.find((period) => period.id === selectedSeasonalPeriodId) ?? null;

  const handlePriceSaved = useCallback(
    (periodId: string, price: string) => {
      onSeasonalPricingsChange?.(
        seasonalPricings.map((period) => (period.id === periodId ? { ...period, price } : period)),
      );
    },
    [onSeasonalPricingsChange, seasonalPricings],
  );

  const seasonal = useSeasonalPricingDraft({
    period: selectedPeriod,
    fallbackUnit: baseDraft.baseRate.unit,
    fallbackDuration: baseDraft.baseRate.duration,
    isProrated: baseDraft.isProrated,
    onPriceSaved: handlePriceSaved,
  });

  const isSeason = Boolean(selectedPeriod);
  const draft = isSeason ? seasonal.draft : baseDraft;

  /** Leaving a season must not drop what the debounce has not written yet. */
  const selectPeriod = useCallback(
    async (id: string | null) => {
      await seasonal.flush();
      onSelectSeasonalPeriod?.(id);
    },
    [onSelectSeasonalPeriod, seasonal],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pricing")}</CardTitle>
        {/* The banner used to repeat the season name shown in the selector and
            spend a whole strip on three rare actions. The dates it alone carried
            are now the card's subtitle; the actions live in the header menu. */}
        {selectedPeriod && (
          <CardDescription className="tabular-nums">
            {format(new Date(`${selectedPeriod.startDate}T00:00:00`), "d MMM yyyy", {
              locale: dateLocale,
            })}
            {" → "}
            {format(new Date(`${selectedPeriod.endDate}T00:00:00`), "d MMM yyyy", {
              locale: dateLocale,
            })}
          </CardDescription>
        )}
        <CardAction className="flex min-w-0 flex-wrap items-center gap-2">
          <SeasonalSaveIndicator status={seasonal.status} />
          <Select
            value={watchedValues.pricingKind ?? "duration"}
            onValueChange={(value) => {
              const nextKind: PricingKind = value === "fixed" ? "fixed" : "duration";
              form.setFieldValue("pricingKind", nextKind);
              if (nextKind !== "fixed" && watchedValues.stockKind === "consumable") {
                form.setFieldValue("stockKind", "returnable");
              }
            }}
            disabled={isSaving || isSeason}
          >
            <SelectTrigger className="w-auto min-w-32" aria-label={t("pricingKindLabel")}>
              <SelectValue>
                {watchedValues.pricingKind === "fixed"
                  ? t("pricingKindFixed")
                  : t("pricingKindDuration")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="duration" label={t("pricingKindDuration")}>
                {t("pricingKindDuration")}
              </SelectItem>
              <SelectItem value="fixed" label={t("pricingKindFixed")}>
                {t("pricingKindFixed")}
              </SelectItem>
            </SelectContent>
          </Select>

          {productId && (
            <div className="flex items-center gap-1.5">
              {/* `[&_button]:h-9` lifts the selector's size="sm" trigger onto the
                  Select's min-h-9, without editing the shipped component. */}
              <div className="[&_button]:h-9">
                <PricingPeriodSelector
                  selectedPeriodId={selectedSeasonalPeriodId}
                  seasonalPricings={seasonalPricings}
                  basePriceValue={watchedValues.basePriceDuration?.price}
                  onSelectPeriod={selectPeriod}
                  onAddPeriod={() => {
                    setEditingPeriod(null);
                    setDialogOpen(true);
                  }}
                  isLoading={isLoadingSeasonalPricings}
                  trailing={
                    seasonalPricings.length > 0 ? (
                      <Badge variant="secondary" size="sm" className="tabular-nums">
                        {seasonalPricings.length}
                      </Badge>
                    ) : null
                  }
                />
              </div>
              {selectedPeriod && (
                <SeasonalActionsMenu
                  period={selectedPeriod}
                  disabled={isSaving}
                  onBeforeDuplicate={seasonal.flush}
                  onEditMetadata={() => {
                    setEditingPeriod(selectedPeriod);
                    setDialogOpen(true);
                  }}
                  onDeleted={() => {
                    onSeasonalPricingsChange?.(
                      seasonalPricings.filter((period) => period.id !== selectedPeriod.id),
                    );
                    onSelectSeasonalPeriod?.(null);
                  }}
                  onDuplicated={(newId) => {
                    // The parent refetches on an empty list; then select the copy.
                    onSeasonalPricingsChange?.([]);
                    onSelectSeasonalPeriod?.(newId);
                  }}
                />
              )}
            </div>
          )}
        </CardAction>
      </CardHeader>

      <CardPanel>
        <PricingLadder
          draft={draft}
          form={form}
          watchedValues={watchedValues}
          currency={currency}
          currencySymbol={currencySymbol}
          storeTaxSettings={storeTaxSettings}
          disabled={isSaving}
          scope={isSeason ? "season" : watchedValues.pricingKind === "fixed" ? "fixed" : "base"}
          showValidationErrors={showValidationErrors}
          duplicateRateTierIndexes={duplicateRateTierIndexes}
          onSwitchToBase={() => {
            void selectPeriod(null);
          }}
        />
        {/* Flush under the folded deposit and VAT row, so both read as one list. */}
        <div className={isSeason ? "mt-3" : undefined}>
          <form.Field name="promotion">
            {() => (
              <ProductPromotionField
                form={form}
                values={watchedValues}
                timezone={storeTimezone}
                currency={currency}
                disabled={isSaving}
                showValidationErrors={showValidationErrors}
              />
            )}
          </form.Field>
        </div>
      </CardPanel>

      {productId && (
        <SeasonalPeriodFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          productId={productId}
          editingData={
            editingPeriod
              ? {
                  id: editingPeriod.id,
                  name: editingPeriod.name,
                  startDate: editingPeriod.startDate,
                  endDate: editingPeriod.endDate,
                }
              : null
          }
          basePriceDuration={watchedValues.basePriceDuration}
          baseRateTiers={watchedValues.rateTiers || []}
          onCreated={(created: SeasonalPricingData) => {
            onSeasonalPricingsChange?.(
              [...seasonalPricings, created].sort((a, b) => a.startDate.localeCompare(b.startDate)),
            );
            onSelectSeasonalPeriod?.(created.id);
          }}
          /* The dialog deliberately does not persist an edit — it hands the new
             metadata back and expects the caller to write it, price and rates
             included, or the whole period would be saved without them. */
          onUpdated={async (id: string, name: string, startDate: string, endDate: string) => {
            const period = seasonalPricings.find((candidate) => candidate.id === id);
            if (!period) return;

            const isCurrent = id === selectedSeasonalPeriodId;
            const price = (isCurrent ? seasonal.draft.baseRate.price : period.price).replace(
              ",",
              ".",
            );
            const rateTiers = (isCurrent ? seasonal.draft.tiers : toStoredTiers(period)).map(
              (tier) => ({
                price: tier.price.replace(",", "."),
                duration: tier.duration,
                unit: tier.unit,
              }),
            );

            const result = await updateSeasonalPricing(id, {
              name,
              startDate,
              endDate,
              price,
              rateTiers,
            });
            if (result && "error" in result) {
              toastManager.add({ title: result.error, type: "error" });
              return;
            }

            onSeasonalPricingsChange?.(
              seasonalPricings
                .map((candidate) =>
                  candidate.id === id
                    ? { ...candidate, name, startDate, endDate, price }
                    : candidate,
                )
                .sort((a, b) => a.startDate.localeCompare(b.startDate)),
            );
          }}
        />
      )}
    </Card>
  );
}
