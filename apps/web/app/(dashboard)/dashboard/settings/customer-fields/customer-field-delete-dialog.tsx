"use client";

import { useTranslations } from "next-intl";

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
  field: { id: string; label: string; valueCount: number; isActive: boolean } | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (id: string) => void;
  onConfirm: (id: string) => void;
}

/** Deleting erases customers' values, so archiving is offered first whenever there are any. */
export const CustomerFieldDeleteDialog = ({
  field,
  isPending,
  onOpenChange,
  onArchive,
  onConfirm,
}: CustomerFieldDeleteDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.deleteDialog");

  return (
    <AlertDialog open={field !== null} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { label: field?.label ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description")}
            {field && field.valueCount > 0
              ? ` ${t("withValues", { count: field.valueCount })}`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>{t("cancel")}</AlertDialogClose>
          {field && field.valueCount > 0 && field.isActive && (
            <Button variant="secondary" disabled={isPending} onClick={() => onArchive(field.id)}>
              {t("archiveInstead")}
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
