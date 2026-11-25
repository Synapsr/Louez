"use client";

import { useState } from "react";

import { Link2, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";

import { PartnerSpacePosterDialog, type PartnerPosterProps } from "./partner-space-poster-dialog";
import { useCopyPartnerLink } from "./use-copy-partner-link";

/**
 * The partner's link at hand in the banner, without scrolling: copied in one
 * click, or its QR poster in one more.
 */
export const PartnerSpaceQuickActions = (props: PartnerPosterProps) => {
  const t = useTranslations("partnerSpace.quick");
  const [posterOpen, setPosterOpen] = useState(false);
  const copy = useCopyPartnerLink(props.link);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        <Link2 className="size-4" aria-hidden />
        {t("copy")}
      </button>
      <button
        type="button"
        onClick={() => setPosterOpen(true)}
        aria-label={t("poster")}
        title={t("poster")}
        className="inline-flex size-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        <QrCode className="size-5" aria-hidden />
      </button>
      <PartnerSpacePosterDialog {...props} open={posterOpen} onOpenChange={setPosterOpen} />
    </div>
  );
};
