"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

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
  toastManager,
} from "@louez/ui";

import { useRemovePassword } from "./use-remove-password";

export const RemovePasswordDialog = () => {
  const t = useTranslations("dashboard.settings.accountSettings.signIn");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const removal = useRemovePassword({
    onSuccess: () => {
      setOpen(false);
      toastManager.add({ title: t("passwordRemovedToast"), type: "success" });
      router.refresh();
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" className="text-destructive" />}
      >
        {t("removePassword")}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removePasswordTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("removePasswordDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={removal.isPending} />}>
            {t("cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            isPending={removal.isPending}
            onClick={() => removal.mutate()}
          >
            {t("removePasswordConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
