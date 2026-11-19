"use client";

import Link from "next/link";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AiReadinessItem, AiReadinessItemKey } from "@louez/api/contracts/ai-visibility";
import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

/** Where each item is fixed in the dashboard. */
const FIX_PAGES: Record<AiReadinessItemKey, string> = {
  description: "/online-store/identity",
  address: "/online-store/contact",
  businessHours: "/dashboard/settings/hours",
  products: "/dashboard/products",
};

/** One readiness item: ready, or what it lacks and the page that fixes it. */
export const AiReadinessRow = ({ item, onFix }: { item: AiReadinessItem; onFix: () => void }) => {
  const t = useTranslations("dashboard.visibility.ai");
  const detail =
    item.key === "products" && item.count
      ? item.count.total === 0
        ? t("items.products.none")
        : t("items.products.count", { ready: item.count.ready, total: item.count.total })
      : t(`items.${item.key}.missing`);

  return (
    <li className="flex items-start gap-3 p-3 sm:items-center">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full sm:mt-0",
          item.ready
            ? "bg-badge-success-background text-badge-success-foreground"
            : "border-muted-foreground/40 border border-dashed",
        )}
        aria-hidden
      >
        {item.ready && <Check className="size-3.5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", item.ready && "text-muted-foreground")}>
            {t(`items.${item.key}.title`)}
            <span className="sr-only">
              {" "}
              — {item.ready ? t("status.ready") : t("status.missing")}
            </span>
          </p>
          {!item.ready && <p className="text-muted-foreground text-sm">{detail}</p>}
        </div>
        {!item.ready && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 self-start sm:self-center"
            render={<Link href={FIX_PAGES[item.key]} />}
            onClick={onFix}
          >
            {t("fix")}
          </Button>
        )}
      </div>
    </li>
  );
};
