"use client";

import { useState } from "react";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@louez/ui";

interface NeedsALookHandleDialogProps {
  /** An unconfirmed refund: its amount stays held back, and the confirmation says so. */
  heldBack: boolean;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}

/** "Mark as handled", confirmed first: it hides the item for the whole team. */
export const NeedsALookHandleDialog = ({
  heldBack,
  pending,
  onConfirm,
}: NeedsALookHandleDialogProps) => {
  const t = useTranslations("dashboard.needsALook");
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        {pending && <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />}
        {t("markHandled")}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("confirm.description")}
            {heldBack && <> {t("confirm.heldBack")}</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t("confirm.cancel")}
          </AlertDialogClose>
          <AlertDialogClose render={<Button />} onClick={() => void onConfirm()}>
            {t("confirm.confirm")}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
