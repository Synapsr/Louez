"use client";

import { useEffect, useRef, useState } from "react";

import { log } from "evlog/next/client";
import { Check, Copy, Facebook, Link2, Mail, MessageCircle, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VisitSource } from "@louez/api/contracts/visibility";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

import { withVisitSource } from "@/lib/visibility/util.visit-source";

import { useVisibilityAnalytics, type VisibilityPlacement } from "./use-visibility-analytics";

const COPIED_FEEDBACK_MS = 2000;
const STORE_TARGET = "store";

/** A product the loueur can share on its own: its name and its page. */
export interface ShareableProduct {
  id: string;
  name: string;
  url: string;
}

interface SharePanelProps {
  storeId: string;
  storeName: string;
  storeUrl: string;
  /** When given, the loueur may share one product's page instead of the store. */
  products?: readonly ShareableProduct[];
  placement: VisibilityPlacement;
}

type CopyKind = "link" | "message";

/**
 * The store's link and a ready message, sent through the loueur's own apps.
 * Every link carries its channel (`?via=`), so the visits it brings are
 * counted for it on the "Se faire connaître" page.
 */
export const SharePanel = ({
  storeId,
  storeName,
  storeUrl,
  products = [],
  placement,
}: SharePanelProps) => {
  const t = useTranslations("dashboard.visibility.share");
  const analytics = useVisibilityAnalytics(storeId);
  const [targetId, setTargetId] = useState(STORE_TARGET);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const product = products.find((candidate) => candidate.id === targetId) ?? null;
  const baseUrl = product?.url ?? storeUrl;
  const target = product ? "product" : "store";

  const messageFor = (url: string) =>
    product
      ? t("messageProduct", { productName: product.name, storeName, url })
      : t("messageStore", { storeName, url });

  const used = (channel: VisitSource) => analytics.shareUsed(placement, channel, target);

  const open = (channel: VisitSource, href: string) => {
    used(channel);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const copy = async (kind: CopyKind) => {
    const link = withVisitSource(baseUrl, "copy");
    try {
      await navigator.clipboard.writeText(kind === "link" ? link : messageFor(link));
      used("copy");
      setCopied(kind);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
    } catch (error) {
      log.warn({ action: "visibility_share_copy_failed", error: String(error) });
    }
  };

  const channels: {
    key: string;
    label: string;
    icon: typeof Mail;
    iconClass: string;
    onClick: () => void;
    done?: boolean;
  }[] = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: MessageCircle,
      iconClass: "share-option-icon--whatsapp",
      onClick: () =>
        open(
          "whatsapp",
          `https://wa.me/?text=${encodeURIComponent(messageFor(withVisitSource(baseUrl, "whatsapp")))}`,
        ),
    },
    {
      key: "sms",
      label: "SMS",
      icon: Smartphone,
      iconClass: "share-option-icon--sms",
      onClick: () =>
        open("sms", `sms:?body=${encodeURIComponent(messageFor(withVisitSource(baseUrl, "sms")))}`),
    },
    {
      key: "email",
      label: t("email"),
      icon: Mail,
      iconClass: "share-option-icon--email",
      onClick: () =>
        open(
          "email",
          `mailto:?subject=${encodeURIComponent(t("emailSubject", { storeName }))}&body=${encodeURIComponent(messageFor(withVisitSource(baseUrl, "email")))}`,
        ),
    },
    {
      key: "facebook",
      label: "Facebook",
      icon: Facebook,
      iconClass: "share-option-icon--facebook",
      onClick: () =>
        open(
          "facebook",
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(withVisitSource(baseUrl, "facebook"))}`,
        ),
    },
    {
      key: "copyLink",
      label: copied === "link" ? t("copied") : t("copyLink"),
      icon: copied === "link" ? Check : Link2,
      iconClass: "share-option-icon--copy",
      onClick: () => void copy("link"),
      done: copied === "link",
    },
    {
      key: "copyMessage",
      label: copied === "message" ? t("copied") : t("copyMessage"),
      icon: copied === "message" ? Check : Copy,
      iconClass: "share-option-icon--copy",
      onClick: () => void copy("message"),
      done: copied === "message",
    },
  ];

  return (
    <div className="space-y-4">
      {products.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("targetLabel")}</p>
          <Select value={targetId} onValueChange={(value) => setTargetId(String(value))}>
            <SelectTrigger>
              <SelectValue>{product?.name ?? t("targetStore")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STORE_TARGET} label={t("targetStore")}>
                {t("targetStore")}
              </SelectItem>
              {products.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id} label={candidate.name}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <p className="bg-muted/40 text-muted-foreground rounded-xl p-3 text-sm break-words whitespace-pre-line">
        {messageFor(baseUrl)}
      </p>

      <div className="grid grid-cols-2 gap-1">
        {channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            className={cn("share-option", channel.done && "bg-emerald-50 dark:bg-emerald-900/20")}
            onClick={channel.onClick}
          >
            <span className={cn("share-option-icon", channel.iconClass)}>
              <channel.icon className="size-5" />
            </span>
            <span
              className={cn(
                "min-w-0 text-sm leading-tight font-medium",
                channel.done && "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {channel.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
