"use client";

import { useState } from "react";

import { log } from "evlog/next/client";
import { Copy, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  toastManager,
} from "@louez/ui";

import { QrPoster } from "@/components/dashboard/visibility/qr-poster";
import { toDisplayUrl } from "@/components/dashboard/visibility/util.poster";

interface PartnerSpaceLinkProps {
  storeName: string;
  link: string;
  code: string;
  partnerName: string;
  /** The store's colour and logo: the partner's poster wears them. */
  accentColor: string | null;
  logoUrl: string | null;
}

/** The partner's own link in its space: to copy, or to print as a QR poster for its desk. */
export const PartnerSpaceLink = ({
  storeName,
  link,
  code,
  partnerName,
  accentColor,
  logoUrl,
}: PartnerSpaceLinkProps) => {
  const t = useTranslations("partnerSpace.link");
  const [posterOpen, setPosterOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toastManager.add({ title: t("copied"), type: "success" });
    } catch (error) {
      log.warn({ action: "partner_space_link_copy_failed", error: String(error) });
    }
  };

  return (
    <div className="space-y-3">
      <p className="bg-muted/50 rounded-lg px-3 py-2 font-mono text-sm break-all">
        {toDisplayUrl(link)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <Copy />
          {t("copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPosterOpen(true)}>
          <QrCode />
          {t("poster")}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">{t("code", { code })}</p>

      <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("posterTitle")}</DialogTitle>
            <DialogDescription>{t("posterDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <QrPoster
              storeName={storeName}
              url={link}
              displayUrl={link}
              fileName={`${t("posterFileName")}-${code}`}
              hint={t("posterHint")}
              onSave={() => undefined}
              accentColor={accentColor}
              logoUrl={logoUrl}
              recommendedBy={t("posterRecommended", { partner: partnerName })}
            />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
};
