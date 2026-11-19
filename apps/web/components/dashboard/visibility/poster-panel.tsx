"use client";

import { useTranslations } from "next-intl";

import { withVisitSource } from "@/lib/visibility/util.visit-source";

import { QrPoster } from "./qr-poster";
import { useVisibilityAnalytics, type VisibilityPlacement } from "./use-visibility-analytics";

interface PosterPanelProps {
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeUrl: string;
  placement: VisibilityPlacement;
}

/**
 * The counter poster: the store's name, its QR code (marked `via=qr`) and its
 * address, saved as a PNG the loueur prints or keeps on their phone.
 */
export const PosterPanel = ({
  storeId,
  storeName,
  storeSlug,
  storeUrl,
  placement,
}: PosterPanelProps) => {
  const t = useTranslations("dashboard.visibility.poster");
  const analytics = useVisibilityAnalytics(storeId);

  return (
    <QrPoster
      storeName={storeName}
      url={withVisitSource(storeUrl, "qr")}
      displayUrl={storeUrl}
      fileName={`${t("fileName")}-${storeSlug}`}
      hint={t("hint")}
      onSave={() => analytics.shareUsed(placement, "qr", "store")}
    />
  );
};
