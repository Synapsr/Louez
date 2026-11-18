"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PartyPopper, Share2 } from "lucide-react";

import { Button } from "@louez/ui";

import { ShareModal } from "@/components/dashboard/home/share-modal";

import { DeleteTestReservationButton } from "./delete-test-reservation-button";

interface TestReservationFinishProps {
  reservationId: string;
  storefrontUrl: string;
  hasMarketplaceChannel: boolean;
}

/** The end of the test: share the store, then delete what the test left. */
export const TestReservationFinish = ({
  reservationId,
  storefrontUrl,
  hasMarketplaceChannel,
}: TestReservationFinishProps) => {
  const t = useTranslations("dashboard.testReservation.done");
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <PartyPopper className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShareOpen(true)}>
          <Share2 />
          {t("share")}
        </Button>
        {hasMarketplaceChannel && (
          <Button variant="outline" render={<Link href="/dashboard/settings/marketplace" />}>
            {t("marketplace")}
          </Button>
        )}
        <DeleteTestReservationButton reservationId={reservationId} />
      </div>
      <ShareModal open={shareOpen} onOpenChange={setShareOpen} storeUrl={storefrontUrl} />
    </div>
  );
};
