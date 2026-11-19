"use client";

import { useState } from "react";

import { log } from "evlog/next/client";
import { Copy, Mail, MessageCircle, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Partner } from "@louez/api/contracts/partners";
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

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { QrPoster } from "@/components/dashboard/visibility/qr-poster";
import { toDisplayUrl } from "@/components/dashboard/visibility/util.poster";

import type { PartnerShareChannel } from "./use-partners-analytics";

interface PartnerLinkCardProps {
  partner: Partner;
  storeName: string;
  link: string;
  /** The ready message: the link, the rule and the partner's space. */
  message: string;
  /** The store's colour and logo, for the partner's poster. */
  accentColor: string | null;
  logoUrl: string | null;
  onShared: (channel: PartnerShareChannel) => void;
}

/** The partner's link, ready to copy, print as a QR poster, or send to the partner. */
export const PartnerLinkCard = ({
  partner,
  storeName,
  link,
  message,
  onShared,
  accentColor,
  logoUrl,
}: PartnerLinkCardProps) => {
  const t = useTranslations("dashboard.partners.link");
  const [posterOpen, setPosterOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      onShared("copy");
      toastManager.add({ title: t("copied"), type: "success" });
    } catch (error) {
      log.warn({ action: "partner_link_copy_failed", error: String(error) });
    }
  };

  const open = (channel: PartnerShareChannel, href: string) => {
    onShared(channel);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const subject = t("emailSubject", { store: storeName });
  const email = partner.contact.email ?? "";

  return (
    <DashboardSectionCard
      title={t("title")}
      description={t("description", { partner: partner.name })}
    >
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
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              open(
                "email",
                `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
              )
            }
          >
            <Mail />
            {t("sendEmail")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => open("whatsapp", `https://wa.me/?text=${encodeURIComponent(message)}`)}
          >
            <MessageCircle />
            WhatsApp
          </Button>
        </div>
      </div>

      <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("posterTitle", { partner: partner.name })}</DialogTitle>
            <DialogDescription>{t("posterDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <QrPoster
              storeName={storeName}
              url={link}
              fileName={`${t("posterFileName")}-${partner.code}`}
              onSave={() => onShared("qr")}
              accentColor={accentColor}
              logoUrl={logoUrl}
              recommendedBy={t("posterRecommended", { partner: partner.name })}
            />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </DashboardSectionCard>
  );
};
