"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Popover, PopoverContent, PopoverTrigger } from "@louez/ui";
import { CalendarCheckIcon, InfoCircleIcon, PurchaseIcon, TagIcon } from "@louez/ui/icons";

import { WhatsNewLinkCard } from "@/components/dashboard/whats-new-link-card";

/** "Learn more" about per-unit tracking: an info icon beside its card title, so
 *  the title row keeps room for the card's "Examples" link. */
export const ProductFormUnitsLearnMore = () => {
  const t = useTranslations("dashboard.products.form.unitTracking");
  // Controlled for one reason: the changelog card can lift a demo into the media
  // viewer, which is portalled to the body. Every press in there would read as an
  // outside press and dismiss the popover — and the viewer with it — so closing
  // is refused while the demo is up.
  const [open, setOpen] = useState(false);
  const [isDemoViewerOpen, setIsDemoViewerOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && isDemoViewerOpen) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("learnMore")}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-5 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          />
        }
      >
        <InfoCircleIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("modeUnits")}</p>
          <p className="text-muted-foreground text-sm">{t("toggleDescription")}</p>
          <ul className="text-muted-foreground space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <TagIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {t("benefitIdentify")}
            </li>
            <li className="flex items-start gap-2">
              <CalendarCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {t("benefitAvailability")}
            </li>
            <li className="flex items-start gap-2">
              <PurchaseIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {t("benefitInventory")}
            </li>
          </ul>
          {/* The popover sells the mode in three lines; the changelog entry is
              where the whole thing is explained. */}
          <WhatsNewLinkCard
            announcementId="product-variants"
            onMediaViewerOpenChange={setIsDemoViewerOpen}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
