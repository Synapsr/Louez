"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";

import { useFormatLocale } from "@/hooks/use-format-locale";

import type { StorefrontCustomerField } from "./customer-fields.types";
import { getFilledFieldValues } from "./util.customer-field-display";

interface RentalUnitRecapProps {
  fields: readonly StorefrontCustomerField[];
  participantName: string | null | undefined;
  values: CustomerFieldValues;
}

/** One line per unit: "Léa — Taille : 172 cm · Pointure : 38". */
export const RentalUnitRecap = ({ fields, participantName, values }: RentalUnitRecapProps) => {
  const t = useTranslations("storefront.customerFields");
  const tFields = useTranslations("dashboard.customers.fields");
  const { intl } = useFormatLocale();
  const name = participantName?.trim();
  const filled = getFilledFieldValues(fields, values, {
    intlLocale: intl,
    yesLabel: tFields("yes"),
  });

  if (!name && filled.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("unitEmpty")}</p>;
  }

  return (
    <p className="text-sm">
      {name && <span className="font-medium">{name}</span>}
      {name && filled.length > 0 && <span className="text-muted-foreground"> — </span>}
      {filled.length > 0 && (
        <span className="text-muted-foreground">
          {filled
            .map((item) => t("recapValue", { label: item.label, value: item.value }))
            .join(" · ")}
        </span>
      )}
    </p>
  );
};
