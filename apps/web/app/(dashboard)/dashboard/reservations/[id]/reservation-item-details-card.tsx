"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ReservationItemDetailsView } from "@louez/api/services/customer-fields-online";
import { Button } from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { orpc } from "@/lib/orpc/react";

import { ReservationItemDetailRow } from "./reservation-item-detail-row";
import { ReservationItemDetailsSheet } from "./reservation-item-details-sheet";
import { getItemDetailRows } from "./util.reservation-item-details";

interface ReservationItemDetailsCardProps {
  reservationId: string;
  /** Read with the page, so the card does not pop in under the items. */
  initialItems?: ReservationItemDetailsView[];
}

/**
 * "Détails de la location": what each rented unit needs (height, shoe
 * size…), for the team preparing the equipment. Absent when no line of the
 * reservation carries per-unit fields.
 */
export const ReservationItemDetailsCard = ({
  reservationId,
  initialItems,
}: ReservationItemDetailsCardProps) => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");
  const tCommon = useTranslations("common");
  const [isEditing, setIsEditing] = useState(false);
  const { data } = useQuery({
    ...orpc.dashboard.reservationDetails.itemDetails.queryOptions({ input: { reservationId } }),
    initialData: initialItems ? { items: initialItems } : undefined,
  });

  const lines = data?.items ?? [];
  if (lines.length === 0) return null;

  return (
    <>
      <DashboardSectionCard
        title={t("title")}
        action={
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <Pencil />
            {tCommon("edit")}
          </Button>
        }
      >
        <ul className="divide-y">
          {getItemDetailRows(lines).map((row) => (
            <ReservationItemDetailRow key={row.key} row={row} />
          ))}
        </ul>
      </DashboardSectionCard>
      {isEditing && (
        <ReservationItemDetailsSheet
          reservationId={reservationId}
          lines={lines}
          onClose={() => setIsEditing(false)}
        />
      )}
    </>
  );
};
