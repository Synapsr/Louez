"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Card, CardContent, Checkbox, Separator } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";

import type { EditSummaryFigures } from "../hooks/use-edit-reservation-pricing";
import type { AvailabilityWarning, ReservationCalculations } from "../types";

interface EditReservationSummarySectionProps {
  availabilityWarnings: AvailabilityWarning[];
  /** Totals tax included, stored now and about to be written (`editSummaryFigures`). */
  figures: EditSummaryFigures;
  originalDeposit: number;
  originalDeliveryFee: number;
  calculations: ReservationCalculations;
  deliveryFee: number;
  /** The reservation's currency: every amount is shown in it, at its precision. */
  currency: string;
  isLoading: boolean;
  isDeliveryCalculating: boolean;
  hasChanges: boolean;
  notifyCustomerByEmail: boolean;
  onNotifyCustomerByEmailChange: (checked: boolean) => void;
  hasScheduleChanges: boolean;
  onSave: () => void;
}

export const EditReservationSummarySection = ({
  availabilityWarnings,
  figures,
  originalDeposit,
  originalDeliveryFee,
  calculations,
  deliveryFee,
  currency,
  isLoading,
  isDeliveryCalculating,
  hasChanges,
  notifyCustomerByEmail,
  onNotifyCustomerByEmailChange,
  hasScheduleChanges,
  onSave,
}: EditReservationSummarySectionProps) => {
  const t = useTranslations("dashboard.reservations");
  const { intl: formatLocale } = useFormatLocale();
  const money = (amount: number) => formatCurrency(amount, currency, formatLocale);
  const { difference, balance } = figures;

  const scrollToFirstConflict = () => {
    const target = document.getElementById(
      `edit-item-product-${availabilityWarnings[0]?.productId}`,
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  };

  return (
    <Card className="lg:sticky lg:top-24">
      <CardContent className="p-4 sm:p-6">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t("edit.summary")}</h2>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("edit.before")}</span>
            <span className="tabular-nums">{money(figures.before)}</span>
          </div>

          <Separator />

          {figures.taxLines && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("subtotalExclTax")}</span>
              <span className="tabular-nums">{money(figures.taxLines.subtotal)}</span>
            </div>
          )}

          {calculations.totalSavings > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600">{t("edit.delivery.savings")}</span>
              <span className="text-emerald-600 tabular-nums">
                -{money(calculations.totalSavings)}
              </span>
            </div>
          )}

          {(deliveryFee > 0 || originalDeliveryFee > 0) && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("edit.delivery.deliveryFee")}</span>
              <span className="tabular-nums">
                {originalDeliveryFee !== deliveryFee && originalDeliveryFee > 0 && (
                  <span className="mr-2 text-muted-foreground line-through">
                    {money(originalDeliveryFee)}
                  </span>
                )}
                {money(deliveryFee)}
              </span>
            </div>
          )}

          {figures.discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("manualForm.globalDiscount.label")}</span>
              <span className="tabular-nums">-{money(figures.discount)}</span>
            </div>
          )}

          {figures.taxLines && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("manualForm.taxLine")}</span>
              <span className="tabular-nums">{money(figures.taxLines.tax)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("edit.after")}</span>
            <span className="font-medium tabular-nums">{money(figures.after)}</span>
          </div>

          <Separator />

          <div className="flex justify-between">
            <span className="font-medium">{t("edit.difference")}</span>
            <span
              className={cn(
                "text-lg font-bold tabular-nums",
                difference > 0 && "text-emerald-600",
                difference < 0 && "text-red-600",
              )}
            >
              {difference > 0 ? "+" : ""}
              {money(difference)}
            </span>
          </div>

          {/* What the edit leaves to give back or to pay, from what was paid, not the difference. */}
          {difference !== 0 && balance && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {balance.kind === "refund"
                ? t("edit.adjustmentNegative", { amount: money(balance.amount) })
                : t("payment.rentalRemaining", { formattedAmount: money(balance.amount) })}
            </p>
          )}

          <Separator />

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("edit.deposit")}</span>
            <span className="tabular-nums">
              {originalDeposit !== calculations.deposit && (
                <span className="mr-2 text-muted-foreground line-through">
                  {money(originalDeposit)}
                </span>
              )}
              {money(calculations.deposit)}
            </span>
          </div>
        </div>

        {availabilityWarnings.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {t("edit.availabilityConflicts", {
                    count: availabilityWarnings.length,
                  })}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={scrollToFirstConflict}
              >
                {t("edit.seeConflict")}
              </Button>
            </div>
          </>
        )}

        <Separator className="my-4" />

        <label
          htmlFor="notifyCustomerByEmailSummary"
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 text-sm",
            hasChanges ? "cursor-pointer bg-background" : "cursor-not-allowed bg-muted/40",
          )}
        >
          <Checkbox
            id="notifyCustomerByEmailSummary"
            checked={notifyCustomerByEmail}
            disabled={!hasChanges || isLoading}
            onCheckedChange={(checked) => onNotifyCustomerByEmailChange(checked === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block font-medium">{t("edit.notifyCustomerByEmail")}</span>
            <span className="block text-xs text-muted-foreground">
              {hasChanges
                ? hasScheduleChanges
                  ? t("edit.notifyCustomerScheduleHelp")
                  : t("edit.notifyCustomerHelp")
                : t("edit.notifyCustomerDisabledHelp")}
            </span>
          </span>
        </label>

        <Button
          className="mt-6 w-full"
          size="lg"
          onClick={onSave}
          isPending={isLoading}
          disabled={isDeliveryCalculating || !hasChanges}
        >
          <ChevronRight data-slot="icon" />
          {t("edit.save")}
        </Button>
      </CardContent>
    </Card>
  );
};
