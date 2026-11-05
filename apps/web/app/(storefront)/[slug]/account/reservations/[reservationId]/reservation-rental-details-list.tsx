"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { ProductImage } from "@/components/product/product-image";
import { RentalUnitRecap } from "@/components/storefront/customer-fields/rental-unit-recap";
import { hasMissingRequiredValue } from "@/components/storefront/customer-fields/util.customer-field-display";

import type { RentalDetailsItem } from "./reservation-rental-details.types";
import { toRentalUnitKey } from "./util.rental-details-form";

interface ReservationRentalDetailsListProps {
  items: RentalDetailsItem[];
}

/** One row per rented unit: which one, for whom, and what was recorded. */
export const ReservationRentalDetailsList = ({ items }: ReservationRentalDetailsListProps) => {
  const t = useTranslations("storefront.account.rentalDetails");
  const tFields = useTranslations("storefront.customerFields");

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.flatMap((item) =>
        item.units.map((unit) => (
          <li
            key={toRentalUnitKey(item.reservationItemId, unit.unitIndex)}
            className="flex min-w-0 items-start gap-3"
          >
            <ProductImage
              src={item.productImage}
              alt={item.productName}
              sizes="64px"
              containerClassName="w-16 shrink-0 rounded-lg bg-muted"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p className="truncate text-base font-medium leading-snug">{item.productName}</p>
                {item.quantity > 1 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {tFields("unitCounter", { index: unit.unitIndex + 1, count: item.quantity })}
                  </span>
                )}
                {hasMissingRequiredValue(item.fields, unit.values) && (
                  <Badge variant="warning">{t("toComplete")}</Badge>
                )}
              </div>
              <RentalUnitRecap
                fields={item.fields}
                participantName={unit.participantName}
                values={unit.values}
              />
            </div>
          </li>
        )),
      )}
    </ul>
  );
};
