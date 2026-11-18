"use client";

import { useState } from "react";

import { log } from "evlog/next/client";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";
import { CheckIcon, CopyIcon, GlobeSolidIcon, OpenInNewIcon, StoreIcon } from "@louez/ui/icons";
import { Share2 } from "lucide-react";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { ShareModal } from "./share-modal";

const COPIED_FEEDBACK_MS = 2000;

interface StorefrontWidgetProps {
  storeId: string;
  storeName: string;
  storeSlug: string;
  className?: string;
}

export const StorefrontWidget = ({
  storeId,
  storeName,
  storeSlug,
  className,
}: StorefrontWidgetProps) => {
  const t = useTranslations("dashboard.home");
  const [copied, setCopied] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const storeUrl = getAbsoluteUrl();
  const storefrontLabel = storeUrl.replace(/^https?:\/\//, "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (error) {
      log.warn({ action: "storefront_url_copy_failed", error: String(error) });
    }
  };

  return (
    <>
      <DashboardSectionCard
        title={t("storefront.title")}
        description={t("storefront.description")}
        icon={StoreIcon}
        accent="progress"
        className={className}
        contentClassName="space-y-3"
        action={
          <Badge variant="success" className="gap-1.5">
            <span className="relative flex size-1.5">
              <span className="bg-badge-success-foreground absolute inline-flex size-full animate-ping rounded-full opacity-75" />
              <span className="bg-badge-success-foreground relative inline-flex size-1.5 rounded-full" />
            </span>
            {t("storefront.online")}
          </Badge>
        }
      >
        <div className="bg-muted/40 flex min-w-0 items-center gap-3 rounded-xl p-3">
          <DashboardIconTile icon={GlobeSolidIcon} accent="progress" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {storefrontLabel}
            </p>
            <p className="text-muted-foreground truncate text-xs">{t("storefront.publicUrl")}</p>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("storefront.visit")}
            render={<a href={storeUrl} target="_blank" rel="noopener noreferrer" />}
          >
            <OpenInNewIcon />
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("storefront.copied") : t("storefront.copy")}
          </Button>
          <Button className="flex-1" onClick={() => setShareModalOpen(true)}>
            <Share2 />
            {t("storefront.share")}
          </Button>
        </div>
      </DashboardSectionCard>

      <ShareModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        storeId={storeId}
        storeName={storeName}
        storeUrl={storeUrl}
      />
    </>
  );
};
