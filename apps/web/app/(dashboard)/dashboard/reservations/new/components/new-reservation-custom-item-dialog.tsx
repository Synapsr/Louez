"use client";

import { useState } from "react";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { AlertTriangle, Check, PenLine, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";
import { getCurrencySymbol } from "@louez/utils";

import { useAppForm } from "@/hooks/form/form";

import { usePricingModeLabels } from "../hooks/use-pricing-mode-labels";
import type { CustomItem } from "../types";
import {
  createCustomItemFormSchema,
  customItemFormFromItem,
  type CustomItemFormError,
  type CustomItemFormOrigin,
  type CustomItemFormValues,
  type CustomItemValues,
  emptyCustomItemForm,
  followingPrice,
  resolveCustomItemForm,
  totalFromUnitPrice,
  unitPriceFromTotal,
} from "../utils/custom-item-form";

const PRICING_MODES: PricingMode[] = ["hour", "day", "week"];

interface NewReservationCustomItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item to edit, or null to add one. */
  item: CustomItem | null;
  startDate: Date | undefined;
  endDate: Date | undefined;
  calculateDurationForMode: (startDate: Date, endDate: Date, mode: PricingMode) => number;
  currency?: string;
  onSave: (values: CustomItemValues) => void;
}

/**
 * Adds a custom item to a new reservation, or edits one already added: name,
 * description, quantity, deposit, pricing period and a price typed as a total
 * or per unit. The parent keys it by opening, so each one starts from the item
 * or empty, and closing it leaves the reservation as it was.
 */
export const NewReservationCustomItemDialog = ({
  open,
  onOpenChange,
  item,
  startDate,
  endDate,
  calculateDurationForMode,
  currency,
  onSave,
}: NewReservationCustomItemDialogProps) => {
  const t = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");
  const { perUnit, units } = usePricingModeLabels();
  const currencySymbol = getCurrencySymbol(currency);

  const getDuration = (mode: PricingMode) =>
    startDate && endDate ? calculateDurationForMode(startDate, endDate, mode) : 0;

  const [origin] = useState<CustomItemFormOrigin | undefined>(() =>
    item ? { item, form: customItemFormFromItem(item, getDuration(item.pricingMode)) } : undefined,
  );

  const messages: Record<CustomItemFormError, string> = {
    priceRequired: t("customItem.priceRequired"),
    selectPeriodFirst: t("customItem.selectPeriodFirst"),
    nameRequired: t("customItem.nameRequired"),
  };

  const form = useAppForm({
    defaultValues: origin?.form ?? emptyCustomItemForm,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: createCustomItemFormSchema({ getDuration, origin, messages }) },
    // The price fields are hidden until there is a period: the toast says what is missing.
    onSubmitInvalid: ({ value }) => {
      const result = resolveCustomItemForm(value, getDuration(value.pricingMode), origin);
      if (!result.ok) toastManager.add({ title: messages[result.errors[0]], type: "error" });
    },
    onSubmit: ({ value }) => {
      const result = resolveCustomItemForm(value, getDuration(value.pricingMode), origin);
      if (result.ok) onSave(result.values);
    },
  });

  const pricingMode = useStore(form.store, (state) => state.values.pricingMode);
  const quantity = useStore(form.store, (state) => state.values.quantity);
  const duration = getDuration(pricingMode);

  // The price that follows is set without its own listener, which would follow back.
  const setFollowingPrice = (field: "unitPrice" | "totalPrice", value: string) =>
    form.setFieldValue(field, value, { dontRunListeners: true });

  const followPrice = (change: Partial<CustomItemFormValues>) => {
    const values = { ...form.state.values, ...change };
    const next = followingPrice(values, getDuration(values.pricingMode));
    setFollowingPrice(next.field, next.value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <form.AppForm>
          {/* The schema is the only check, as it was: the browser's own number
              checks would refuse a total or a deposit the dialog accepts. */}
          <form.Form className="contents" formName="custom-item" noValidate>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PenLine className="h-5 w-5" />
                {origin ? t("customItem.editDialogTitle") : t("customItem.dialogTitle")}
              </DialogTitle>
              <DialogDescription>
                {origin ? t("customItem.editDialogDescription") : t("customItem.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-4">
                <form.AppField name="name">
                  {(field) => (
                    <field.Input
                      label={`${t("customItem.name")} *`}
                      placeholder={t("customItem.namePlaceholder")}
                    />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {(field) => (
                    <field.Textarea
                      label={t("customItem.description")}
                      placeholder={t("customItem.descriptionPlaceholder")}
                      className="resize-none"
                      rows={2}
                    />
                  )}
                </form.AppField>
                <div className="grid grid-cols-2 gap-4">
                  <form.AppField
                    name="quantity"
                    listeners={{ onChange: ({ value }) => followPrice({ quantity: value }) }}
                  >
                    {(field) => (
                      <field.Input label={t("customItem.quantity")} type="number" min="1" />
                    )}
                  </form.AppField>
                  <form.AppField name="deposit">
                    {(field) => (
                      <field.Input
                        label={t("customItem.deposit")}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        suffix={currencySymbol}
                      />
                    )}
                  </form.AppField>
                </div>
                <form.AppField
                  name="pricingMode"
                  listeners={{ onChange: ({ value }) => followPrice({ pricingMode: value }) }}
                >
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="custom-item-pricing-mode">
                        {t("customItem.pricingPeriod")}
                      </Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          const mode = PRICING_MODES.find((candidate) => candidate === value);
                          if (mode) field.handleChange(mode);
                        }}
                      >
                        <SelectTrigger id="custom-item-pricing-mode">
                          <SelectValue>{perUnit(field.state.value)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {PRICING_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode} label={perUnit(mode)}>
                              {perUnit(mode)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </form.AppField>
                {duration > 0 ? (
                  <div className="bg-muted/30 space-y-3 rounded-lg border p-3">
                    <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
                      <span>{t("customItem.pricingPeriod")}</span>
                      <span className="text-foreground font-medium">
                        {duration} {units(pricingMode, duration)} × {quantity || 1}{" "}
                        {t("customItem.units")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <form.AppField
                        name="totalPrice"
                        listeners={{
                          onChange: ({ value }) =>
                            setFollowingPrice(
                              "unitPrice",
                              unitPriceFromTotal(value, form.state.values.quantity, duration),
                            ),
                        }}
                      >
                        {(field) => (
                          <field.Input
                            label={`${t("customItem.totalPrice")} *`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            suffix={currencySymbol}
                            onFocus={() => form.setFieldValue("priceField", "total")}
                          />
                        )}
                      </form.AppField>
                      <form.AppField
                        name="unitPrice"
                        listeners={{
                          onChange: ({ value }) =>
                            setFollowingPrice(
                              "totalPrice",
                              totalFromUnitPrice(value, form.state.values.quantity, duration),
                            ),
                        }}
                      >
                        {(field) => (
                          <field.Input
                            label={t("customItem.unitPrice")}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            suffix={`${currencySymbol}/${perUnit(pricingMode)}`}
                            className="pr-12"
                            onFocus={() => form.setFieldValue("priceField", "unit")}
                          />
                        )}
                      </form.AppField>
                    </div>
                  </div>
                ) : (
                  <p className="bg-warning/10 flex items-start gap-2.5 rounded-lg p-3 text-sm">
                    <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
                    {t("customItem.selectPeriodFirst")}
                  </p>
                )}
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <form.SubscribeButton>
                {origin ? <Check data-slot="icon" /> : <Plus data-slot="icon" />}
                {origin ? tCommon("save") : t("customItem.addButton")}
              </form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
