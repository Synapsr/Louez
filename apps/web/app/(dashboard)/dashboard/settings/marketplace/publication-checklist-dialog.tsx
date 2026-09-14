"use client";

import { useState } from "react";

import Link from "next/link";

import { useFormatter, useTranslations } from "next-intl";

import type { MarketplaceChannelState } from "@louez/api/services";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
} from "@louez/ui";
import { CheckCircleIcon, CircleIcon, ListCheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

interface PublicationChecklistDialogProps {
  checklist: MarketplaceChannelState["checklist"];
  /** ISO date of the terms acceptance, null until the owner checks the box. */
  termsAcceptedAt: string | null;
  isPending: boolean;
  onAcceptTerms: () => void;
}

/** Checklist rows whose remedy lives on another settings/dashboard page. */
const CHECKLIST_ITEMS = [
  { key: "addressAndGeolocation", href: "/online-store/contact" },
  { key: "activeProductWithImageAndPrice", href: "/dashboard/products" },
  { key: "stripeChargesEnabled", href: "/dashboard/settings/payments" },
  { key: "cgvPresent", href: "/online-store/legal" },
] as const;

/**
 * The publication checklist behind a small trigger: it only matters while
 * something is missing, so the row shows the score and the dialog carries the
 * detail. Once everything is checked the caller stops rendering it.
 */
export const PublicationChecklistDialog = ({
  checklist,
  termsAcceptedAt,
  isPending,
  onAcceptTerms,
}: PublicationChecklistDialogProps) => {
  const t = useTranslations("dashboard.settings.salesChannels.checklist");
  const format = useFormatter();
  const [open, setOpen] = useState(false);

  const termsAccepted = checklist.marketplaceTermsAccepted;
  const completedCount =
    CHECKLIST_ITEMS.filter((item) => checklist[item.key]).length + (termsAccepted ? 1 : 0);
  const totalCount = CHECKLIST_ITEMS.length + 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ListCheckIcon className="size-4" />
        {t("openAction")}
        <Badge variant={checklist.complete ? "success" : "pending"} size="sm">
          {t("progress", { done: completedCount, total: totalCount })}
        </Badge>
      </Button>

      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListCheckIcon className="size-5 shrink-0" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <ul className="space-y-2">
            {CHECKLIST_ITEMS.map((item) => {
              const done = checklist[item.key];

              return (
                <li
                  key={item.key}
                  className={cn(
                    "flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 transition-colors",
                    done && "border-badge-success-foreground/30 bg-badge-success-background/40",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {done ? (
                      <CheckCircleIcon className="text-badge-success-foreground mt-0.5 size-5 shrink-0" />
                    ) : (
                      <CircleIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{t(`items.${item.key}.label`)}</p>
                      <p className="text-muted-foreground text-sm">
                        {t(`items.${item.key}.description`)}
                      </p>
                    </div>
                  </div>
                  {done ? (
                    <span className="text-muted-foreground shrink-0 text-xs">{t("doneLabel")}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      render={<Link href={item.href} />}
                    >
                      {t("fixAction")}
                    </Button>
                  )}
                </li>
              );
            })}

            <li
              className={cn(
                "rounded-lg border p-3 transition-colors",
                termsAccepted &&
                  "border-badge-success-foreground/30 bg-badge-success-background/40",
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id="marketplace-terms"
                  className="mt-0.5"
                  checked={termsAccepted}
                  disabled={termsAccepted || isPending}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onAcceptTerms();
                    }
                  }}
                />
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="marketplace-terms" className="text-sm font-medium">
                    {t("items.marketplaceTermsAccepted.label")}
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    {t("items.marketplaceTermsAccepted.description")}
                  </p>
                  {termsAcceptedAt && (
                    <p className="text-muted-foreground text-xs">
                      {t("items.marketplaceTermsAccepted.acceptedAt", {
                        date: format.dateTime(new Date(termsAcceptedAt), { dateStyle: "medium" }),
                      })}
                    </p>
                  )}
                </div>
              </div>
            </li>
          </ul>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
