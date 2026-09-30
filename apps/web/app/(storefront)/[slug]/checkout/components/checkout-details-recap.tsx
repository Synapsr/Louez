"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { RentalUnitRecap } from "@/components/storefront/customer-fields/rental-unit-recap";

import type { CheckoutFieldsLine, CheckoutFormValues } from "../checkout.types";
import { toUnitKey } from "../util.checkout-custom-fields";

interface CheckoutDetailsRecapProps {
  /** Cart lines; only those asking item fields are listed. */
  lines: CheckoutFieldsLine[];
  itemDetails: CheckoutFormValues["itemDetails"];
  onEdit: () => void;
}

/** The last look at "Détails de la location" before paying, one line per unit. */
export const CheckoutDetailsRecap = ({ lines, itemDetails, onEdit }: CheckoutDetailsRecapProps) => {
  const t = useTranslations("storefront.checkout");
  const tFields = useTranslations("storefront.customerFields");
  const askingLines = lines.filter((line) => line.itemFields.length > 0);

  if (askingLines.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{t("steps.details")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onEdit}
        >
          {t("modify")}
        </Button>
      </div>
      {askingLines.map((line) => (
        <div key={line.lineId} className="flex flex-col gap-1">
          <p className="font-medium">{line.productName}</p>
          <ul className="flex flex-col gap-1">
            {Array.from({ length: line.quantity }, (_, unitIndex) => {
              const unitKey = toUnitKey(line.lineId, unitIndex);
              const unit = itemDetails[unitKey];
              return (
                <li key={unitKey} className="flex gap-2">
                  {line.quantity > 1 && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {tFields("unitCounter", { index: unitIndex + 1, count: line.quantity })}
                    </span>
                  )}
                  <div className="min-w-0">
                    <RentalUnitRecap
                      fields={line.itemFields}
                      participantName={unit?.participantName}
                      values={unit?.values ?? {}}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};
