"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

interface CheckoutSavedFieldsSummaryProps {
  fields: { id: string; label: string }[];
  onEdit: () => void;
}

/**
 * "Informations déjà renseignées · Modifier". The labels say what is on file
 * without echoing the values (an ID number has no business on screen here).
 */
export const CheckoutSavedFieldsSummary = ({ fields, onEdit }: CheckoutSavedFieldsSummaryProps) => {
  const t = useTranslations("storefront.checkout");

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="min-w-0">
          <p>{t("customFields.savedSummary")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {fields.map((field) => field.label).join(", ")}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground"
        onClick={onEdit}
      >
        {t("modify")}
      </Button>
    </div>
  );
};
