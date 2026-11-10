"use client";

import { useState } from "react";

import { Check, Copy, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { useStorefrontUrl } from "@/hooks/use-storefront-url";

import { ShareModal } from "./share-modal";

const COPIED_FEEDBACK_MS = 1600;

interface ShareStoreActionsProps {
  storeSlug: string;
  storeName: string;
}

/**
 * The two ways to send the storefront out: copy its link, or open the share
 * sheet (WhatsApp, email, SMS, QR code).
 */
export const ShareStoreActions = ({ storeSlug, storeName }: ShareStoreActionsProps) => {
  const t = useTranslations("dashboard.home");
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const storeUrl = getAbsoluteUrl();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      setShareOpen(true);
    }
  };

  return (
    <>
      <Button size="sm" onClick={handleCopy}>
        {copied ? <Check /> : <Copy />}
        {copied ? t("share.copied") : t("share.copyLink")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
        <Share2 />
        {t("storefront.share")}
      </Button>
      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        storeUrl={storeUrl}
        storeName={storeName}
      />
    </>
  );
};
