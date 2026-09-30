"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { AccountCard } from "@/components/storefront/account/account-card";
import { orpc } from "@/lib/orpc/react";

import { ReservationRentalDetailsForm } from "./reservation-rental-details-form";
import { ReservationRentalDetailsList } from "./reservation-rental-details-list";
import type { RentalDetailsData } from "./reservation-rental-details.types";
import { canEditRentalDetails } from "./util.rental-details-form";

interface ReservationRentalDetailsProps {
  reservationId: string;
  /** Read by the page, so the card is there on first paint instead of pushing the page down. */
  initialData: RentalDetailsData;
}

/**
 * "Détails de la location" of the customer's reservation: who uses which unit
 * and the sizes they gave. Editable until the rental starts, for the fields
 * the store lets customers change.
 */
export const ReservationRentalDetails = ({
  reservationId,
  initialData,
}: ReservationRentalDetailsProps) => {
  const t = useTranslations("storefront.account.rentalDetails");
  const tCommon = useTranslations("common");
  const [isEditing, setIsEditing] = useState(false);
  const { data = initialData } = useQuery(
    orpc.storefront.customerFields.reservationDetails.queryOptions({
      input: { reservationId },
      initialData,
    }),
  );

  if (data.items.length === 0) return null;
  const canEdit = canEditRentalDetails(data);

  return (
    <AccountCard
      title={t("title")}
      aside={
        canEdit && !isEditing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            {tCommon("edit")}
          </Button>
        ) : null
      }
    >
      {isEditing && canEdit ? (
        <ReservationRentalDetailsForm
          reservationId={reservationId}
          items={data.items}
          onDone={() => setIsEditing(false)}
        />
      ) : (
        <>
          {canEdit && <p className="-mt-2 text-sm text-muted-foreground">{t("editableHint")}</p>}
          <ReservationRentalDetailsList items={data.items} />
        </>
      )}
    </AccountCard>
  );
};
