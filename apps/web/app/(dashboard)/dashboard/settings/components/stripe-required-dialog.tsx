"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";
import { ArrowRightIcon, CreditCardIcon } from "@louez/ui/icons";

interface StripeRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Opens when the store picks online payment before its Stripe account can charge. */
export const StripeRequiredDialog = ({ open, onOpenChange }: StripeRequiredDialogProps) => {
  const t = useTranslations("dashboard.settings.reservationSettings.stripeRequired");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader className="space-y-4">
          <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
            <CreditCardIcon className="text-primary h-7 w-7" />
          </div>
          <div className="space-y-2 text-center">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogPanel>
          <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">{t("benefits")}</p>
          </div>
        </DialogPanel>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button render={<Link href="/dashboard/settings/payments" />} className="w-full">
            {t("configureStripe")}
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground w-full"
            onClick={() => onOpenChange(false)}
          >
            {t("keepRequest")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
