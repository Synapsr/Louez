"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
  toastManager,
} from "@louez/ui";

import { useStoreHasPermission } from "@/contexts/store-context";
import { reservationsQueries } from "@/lib/queries/reservations.queries";
import {
  testReservationMutations,
  testReservationQueries,
} from "@/lib/queries/test-reservations.queries";

interface DeleteTestReservationButtonProps {
  reservationId: string;
  variant?: "ghost" | "outline";
}

/** "Supprimer les données de test", confirmed, then back to the reservations. */
export const DeleteTestReservationButton = ({
  reservationId,
  variant = "ghost",
}: DeleteTestReservationButtonProps) => {
  const t = useTranslations("dashboard.testReservation.delete");
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = useStoreHasPermission("write");
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    ...testReservationMutations.delete(),
    onSuccess: () => {
      setOpen(false);
      toastManager.add({ title: t("success"), type: "success" });
      void queryClient.invalidateQueries({ queryKey: testReservationQueries.key() });
      void queryClient.invalidateQueries({ queryKey: reservationsQueries.listKey() });
      router.push("/dashboard/reservations");
    },
    onError: () => toastManager.add({ title: t("error"), type: "error" }),
  });

  if (!canWrite) return null;

  return (
    <>
      <Button
        size="sm"
        variant={variant}
        className={variant === "ghost" ? "text-muted-foreground" : undefined}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        {t("button")}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{t("cancel")}</AlertDialogClose>
            <Button
              variant="destructive"
              isPending={mutation.isPending}
              onClick={() => mutation.mutate({ reservationId })}
            >
              {t("confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
};
