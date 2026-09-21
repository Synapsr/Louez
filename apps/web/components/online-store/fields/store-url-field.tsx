"use client";

import { useEffect, useState } from "react";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Label } from "@louez/ui";
import { ExternalLinkIcon } from "@louez/ui/icons";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { useStoreHasPermission } from "@/contexts/store-context";

import { SlugChangeModal } from "./slug-change-modal";

interface StoreUrlFieldProps {
  slug: string;
}

/** The public address of the store, with the slug change behind a pencil. */
export const StoreUrlField = ({ slug }: StoreUrlFieldProps) => {
  const canManageSettings = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.settings.storeSettings");
  const { NEXT_PUBLIC_APP_DOMAIN: domain } = usePublicEnv();
  const { getAbsoluteUrl } = useStorefrontUrl(slug);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!canManageSettings) setOpen(false);
  }, [canManageSettings]);
  const storefrontUrl = getAbsoluteUrl();
  const storefrontLabel = storefrontUrl.replace(/^https?:\/\//, "");

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>{t("storeUrl")}</Label>
        <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-muted/60 pr-1 pl-3">
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm hover:underline"
          >
            <span className="truncate">{storefrontLabel}</span>
            <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
          {canManageSettings && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("slug")}
              onClick={() => setOpen(true)}
              className="shrink-0"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {canManageSettings && (
        <SlugChangeModal open={open} onOpenChange={setOpen} currentSlug={slug} domain={domain} />
      )}
    </>
  );
};
