"use client";

import { useState } from "react";

import { Check, Copy, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@louez/ui";

import { useStoreShare } from "@/contexts/store-share-context";

const COPIED_FEEDBACK_MS = 1600;

/** "https://maison-pointure.louez.io/" → "maison-pointure.louez.io". */
const displayAddress = (url: string) => {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return url;
  }
};

/**
 * The store's public address under the greeting, with its two everyday
 * moves as icons (named by their tooltip): copy the link, or open the share
 * sheet (WhatsApp, e-mail, SMS, QR code). One quiet line — nothing when there
 * is no public page to share yet.
 */
export const HomeShopLine = () => {
  const t = useTranslations("dashboard.home.shop");
  const share = useStoreShare();
  const [copied, setCopied] = useState(false);

  if (!share.url) return null;
  const url = share.url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      share.open();
    }
  };

  const iconClassName =
    "text-muted-foreground hover:text-primary hover:bg-accent focus-visible:ring-ring flex size-7 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-3.5";
  const copyLabel = copied ? t("copied") : t("copy");

  return (
    <TooltipProvider>
      <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-sm">
        <span
          aria-hidden
          className="bg-success ring-success/20 me-1.5 size-1.5 shrink-0 rounded-full ring-3"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-foreground me-1 truncate font-mono text-xs hover:underline"
        >
          {displayAddress(url)}
        </a>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={copy}
                aria-label={copyLabel}
                className={iconClassName}
              />
            }
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </TooltipTrigger>
          <TooltipContent>{copyLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={share.open}
                aria-label={t("share")}
                className={iconClassName}
              />
            }
          >
            <Share2 />
          </TooltipTrigger>
          <TooltipContent>{t("share")}</TooltipContent>
        </Tooltip>
        <span aria-live="polite" className="sr-only">
          {copied ? t("copied") : ""}
        </span>
      </div>
    </TooltipProvider>
  );
};
