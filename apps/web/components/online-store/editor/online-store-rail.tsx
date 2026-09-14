"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import {
  ONLINE_STORE_SECTIONS,
  ONLINE_STORE_SECTION_ICONS,
  type OnlineStoreSection,
  getOnlineStoreSectionHref,
} from "../online-store.constants";

interface OnlineStoreRailProps {
  section: OnlineStoreSection;
}

/**
 * The five sections, in the order a visitor meets them. A vertical rail
 * beside the panel from `lg`, a horizontal strip above it on narrower
 * screens; the active section is the one whose page the sketch draws.
 */
export const OnlineStoreRail = ({ section }: OnlineStoreRailProps) => {
  const t = useTranslations("dashboard.onlineStore");

  return (
    <nav
      aria-label={t("railLabel")}
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-4"
    >
      {ONLINE_STORE_SECTIONS.map((id) => {
        const Icon = ONLINE_STORE_SECTION_ICONS[id];
        const active = id === section;

        return (
          <Link
            key={id}
            href={getOnlineStoreSectionHref(id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:items-start lg:py-2.5",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 lg:mt-0.5" />
            <span className="flex flex-col">
              <span className="whitespace-nowrap">{t(`sections.${id}.label`)}</span>
              <span className="hidden text-xs font-normal text-muted-foreground lg:block">
                {t(`sections.${id}.description`)}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
};
