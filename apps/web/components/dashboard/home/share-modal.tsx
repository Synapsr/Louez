"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";

import { SharePanel } from "@/components/dashboard/visibility/share-panel";

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  storeName: string;
  storeUrl: string;
}

/**
 * The home's quick share: the "Se faire connaître" guide's share tool, and a
 * way to the guide for the poster and the Google profile.
 */
export const ShareModal = ({
  open,
  onOpenChange,
  storeId,
  storeName,
  storeUrl,
}: ShareModalProps) => {
  const t = useTranslations("dashboard.visibility.share");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <SharePanel
            storeId={storeId}
            storeName={storeName}
            storeUrl={storeUrl}
            placement="storefront_card"
          />
          <Link
            href="/dashboard/visibility"
            onClick={() => onOpenChange(false)}
            className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            {t("moreIdeas")}
            <ArrowRight className="size-4" />
          </Link>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
