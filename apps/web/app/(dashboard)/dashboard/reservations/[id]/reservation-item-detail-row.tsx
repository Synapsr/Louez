"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Badge } from "@louez/ui";

import { CustomerFieldValue } from "@/components/dashboard/customers/customer-field-value";

import type { ItemDetailRow } from "./util.reservation-item-details";

interface ReservationItemDetailRowProps {
  row: ItemDetailRow<CustomerFieldDefinition>;
}

/** One rented unit, read at a glance while preparing the equipment: "VTT · 1/2 · Léa". */
export const ReservationItemDetailRow = ({ row }: ReservationItemDetailRowProps) => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {/* Wraps rather than squeezing the name: the badge drops under it on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm">
          <span className="font-medium">{row.productName}</span>
          {row.position && <span className="text-muted-foreground"> · {row.position}</span>}
          {row.participantName && <span className="font-medium"> · {row.participantName}</span>}
        </p>
        {row.isIncomplete && <Badge variant="warning">{t("incomplete")}</Badge>}
      </div>
      {row.entries.length > 0 ? (
        <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {row.entries.map(({ field, value }) => (
            <div key={field.id} className="flex min-w-0 items-center gap-1.5">
              <dt className="text-muted-foreground shrink-0">{field.label}</dt>
              <dd className="min-w-0">
                {value === null ? (
                  <span className="text-badge-warning-foreground">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{t("incomplete")}</span>
                  </span>
                ) : (
                  <CustomerFieldValue definition={field} value={value} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground mt-1 text-sm">{t("empty")}</p>
      )}
    </li>
  );
};
