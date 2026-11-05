"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { ReservationItemDetailsView } from "@louez/api/services/customer-fields-online";
import {
  Button,
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@louez/ui";

import { RootError } from "@/components/form/root-error";

import { ReservationItemDetailUnitFields } from "./reservation-item-detail-unit-fields";
import { useReservationItemDetailsForm } from "./use-reservation-item-details-form";
import { toItemDetailsFormValues } from "./util.reservation-item-details";

interface ReservationItemDetailsSheetProps {
  reservationId: string;
  lines: readonly ReservationItemDetailsView[];
  onClose: () => void;
}

/** Mounted per opening: every rented unit of the reservation, edited in one go. */
export const ReservationItemDetailsSheet = ({
  reservationId,
  lines,
  onClose,
}: ReservationItemDetailsSheetProps) => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");
  const tCommon = useTranslations("common");
  // Frozen at opening: a background refetch must not reset what staff are typing.
  const [defaultValues] = useState(() => toItemDetailsFormValues(lines));
  const { form, rootError, fieldIssues, clearIssue } = useReservationItemDetailsForm({
    reservationId,
    defaultValues,
    onSaved: onClose,
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetPopup>
        <form.AppForm>
          <form.Form className="flex h-full min-h-0 flex-col" formName="reservation-item-details">
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription>{t("sheetDescription")}</SheetDescription>
            </SheetHeader>
            <SheetPanel className="flex-1 space-y-4">
              {/* The form values follow the lines' order, units past the quantity left out. */}
              {lines.map((line, itemPosition) =>
                defaultValues.items[itemPosition]?.units.map((unit, unitPosition) => (
                  <ReservationItemDetailUnitFields
                    key={`${line.reservationItemId}:${unit.unitIndex}`}
                    form={form}
                    itemPosition={itemPosition}
                    unitPosition={unitPosition}
                    reservationItemId={line.reservationItemId}
                    productName={line.productName}
                    productImage={line.productImage}
                    quantity={line.quantity}
                    fields={line.fields}
                    fieldIssues={fieldIssues}
                    onFieldCorrected={clearIssue}
                  />
                )),
              )}
            </SheetPanel>
            {/* Outside the scrolling panel: next to the button that was just pressed. */}
            {rootError && (
              <div className="px-4 pb-3 sm:px-6">
                <RootError error={rootError} />
              </div>
            )}
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <form.SubscribeButton>{tCommon("save")}</form.SubscribeButton>
            </SheetFooter>
          </form.Form>
        </form.AppForm>
      </SheetPopup>
    </Sheet>
  );
};
