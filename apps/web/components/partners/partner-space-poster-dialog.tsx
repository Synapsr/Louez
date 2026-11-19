"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";

import { QrPoster } from "@/components/dashboard/visibility/qr-poster";

export interface PartnerPosterProps {
  storeName: string;
  link: string;
  code: string;
  partnerName: string;
  /** The store's colour and logo: the partner's poster wears them. */
  accentColor: string | null;
  logoUrl: string | null;
}

/** The partner's QR poster, in its store's look, to print for its desk. */
export const PartnerSpacePosterDialog = ({
  open,
  onOpenChange,
  storeName,
  link,
  code,
  partnerName,
  accentColor,
  logoUrl,
}: PartnerPosterProps & { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const t = useTranslations("partnerSpace.link");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("posterTitle")}</DialogTitle>
          <DialogDescription>{t("posterDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <QrPoster
            storeName={storeName}
            url={link}
            fileName={`${t("posterFileName")}-${code}`}
            onSave={() => undefined}
            accentColor={accentColor}
            logoUrl={logoUrl}
            recommendedBy={t("posterRecommended", { partner: partnerName })}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
