"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import {
  BILLING_PAYMENT_METHOD_HREF,
  canManageBilling,
} from "@/lib/billing/reservation-gate-banner";

type ReservationGateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * What the dashboard shows when the card gate refused an action (README §8.4): a
 * confirmation or a booking created as confirmed. The text is generic (design §6.4);
 * the banner above the page carries the service's own wording.
 */
export const ReservationGateDialog = ({ open, onOpenChange }: ReservationGateDialogProps) => {
  const t = useTranslations("dashboard.reservationGate");
  const tCommon = useTranslations("common");
  const { role } = useStore();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pausedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("pausedDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button type="button" variant="outline" />}>
            {tCommon("close")}
          </AlertDialogClose>
          {canManageBilling(role) && (
            <Button render={<Link href={BILLING_PAYMENT_METHOD_HREF} />}>
              {t("manageBilling")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
