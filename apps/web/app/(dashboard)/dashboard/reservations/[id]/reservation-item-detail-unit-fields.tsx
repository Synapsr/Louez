"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Badge } from "@louez/ui";
import type { CustomerFieldIssueCode } from "@louez/validations";
import { cn } from "@louez/utils";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";

import type { ReservationItemDetailsFormApi } from "./use-reservation-item-details-form";
import {
  getItemDetailIssueKey,
  getMissingRequiredFieldIds,
  getUnitPosition,
} from "./util.reservation-item-details";

interface ReservationItemDetailUnitFieldsProps {
  form: ReservationItemDetailsFormApi;
  /** Position of the line and of the unit in the form values. */
  itemPosition: number;
  unitPosition: number;
  reservationItemId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
  fields: readonly CustomerFieldDefinition[];
  fieldIssues: Record<string, CustomerFieldIssueCode>;
  onFieldCorrected: (reservationItemId: string, unitIndex: number, definitionId: string) => void;
}

/** One rented unit in the edit sheet: who uses it, then its fields in the owner's layout and widths. */
export const ReservationItemDetailUnitFields = ({
  form,
  itemPosition,
  unitPosition,
  reservationItemId,
  productName,
  productImage,
  quantity,
  fields,
  fieldIssues,
  onFieldCorrected,
}: ReservationItemDetailUnitFieldsProps) => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");
  const tIssues = useTranslations("dashboard.customers.fields.issues");
  const unit = useStore(
    form.store,
    (state) => state.values.items[itemPosition]?.units[unitPosition],
  );

  if (!unit) return null;

  const position = getUnitPosition(unit.unitIndex, quantity);
  const isIncomplete = getMissingRequiredFieldIds(fields, unit.values).length > 0;

  return (
    <section
      aria-label={position ? `${productName} · ${position}` : productName}
      className="space-y-4 rounded-2xl border p-4"
    >
      <header className="flex items-center gap-3">
        {productImage ? (
          // Product photos come from any storage host the store used.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={productImage}
            alt=""
            className="bg-muted size-9 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        {/* Wraps rather than truncating: the sheet is narrow on a phone. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-sm">
            <span className="font-medium">{productName}</span>
            {position && <span className="text-muted-foreground"> · {position}</span>}
          </p>
          {isIncomplete && <Badge variant="warning">{t("incomplete")}</Badge>}
        </div>
      </header>

      <form.AppField name={`items[${itemPosition}].units[${unitPosition}].participantName`}>
        {(field) => (
          <field.Input
            label={t("participantName")}
            placeholder={t("participantNamePlaceholder")}
            maxLength={100}
            autoComplete="off"
          />
        )}
      </form.AppField>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((definition) => {
          const issue =
            fieldIssues[getItemDetailIssueKey(reservationItemId, unit.unitIndex, definition.id)];
          return (
            <div
              key={definition.id}
              className={cn("min-w-0", definition.width === "full" && "sm:col-span-2")}
            >
              <CustomerFieldControl
                definition={definition}
                inputId={`item-detail-${reservationItemId}-${unit.unitIndex}-${definition.id}`}
                value={unit.values[definition.id] ?? ""}
                error={issue ? tIssues(issue) : undefined}
                onChange={(value) => {
                  form.setFieldValue(`items[${itemPosition}].units[${unitPosition}].values`, {
                    ...unit.values,
                    [definition.id]: value,
                  });
                  onFieldCorrected(reservationItemId, unit.unitIndex, definition.id);
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};
