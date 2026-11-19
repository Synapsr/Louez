"use client";

import { useState } from "react";

import { Copy, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { toDisplayUrl } from "@/components/dashboard/visibility/util.poster";

import { PartnerSpacePosterDialog, type PartnerPosterProps } from "./partner-space-poster-dialog";
import { useCopyPartnerLink } from "./use-copy-partner-link";

/** The partner's own link in its space: to copy, or to print as a QR poster for its desk. */
export const PartnerSpaceLink = (props: PartnerPosterProps) => {
  const t = useTranslations("partnerSpace.link");
  const [posterOpen, setPosterOpen] = useState(false);
  const copy = useCopyPartnerLink(props.link);

  return (
    <div className="space-y-3">
      <p className="bg-muted/50 rounded-lg px-3 py-2 font-mono text-sm break-all">
        {toDisplayUrl(props.link)}
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
      <p className="text-muted-foreground text-sm">{t("code", { code: props.code })}</p>
      <PartnerSpacePosterDialog {...props} open={posterOpen} onOpenChange={setPosterOpen} />
    </div>
  );
};
