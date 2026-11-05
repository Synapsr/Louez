"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
} from "@louez/ui";

interface CustomerFieldDeleteDialogProps {
  field: Pick<
    CustomerFieldDefinition & { valueCount: number },
    "id" | "label" | "valueCount" | "isActive" | "scope"
  > | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Masquer plutôt": off every form, values kept, back with one switch. */
  onHide: (id: string) => void;
  onConfirm: (id: string) => void;
}

/**
 * Deleting erases the values (on customer records, or on rented units for an
 * item field), so hiding the field is offered first whenever there are any.
 */
export const CustomerFieldDeleteDialog = ({
  field,
  isPending,
  onOpenChange,
  onHide,
  onConfirm,
}: CustomerFieldDeleteDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.deleteDialog");
  const isItem = field?.scope === "item";

  return (
    <AlertDialog open={field !== null} onOpenChange={onOpenChange}>
      <AlertDialogPopup className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { label: field?.label ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(isItem ? "descriptionItem" : "description")}
            {field && field.valueCount > 0
              ? ` ${t(isItem ? "withItemValues" : "withValues", { count: field.valueCount })}`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>{t("cancel")}</AlertDialogClose>
          {field && field.valueCount > 0 && field.isActive && (
            <Button variant="secondary" disabled={isPending} onClick={() => onHide(field.id)}>
              {t("hideInstead")}
            </Button>
          )}
          <Button
            variant="destructive"
            isPending={isPending}
            onClick={() => field && onConfirm(field.id)}
          >
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
