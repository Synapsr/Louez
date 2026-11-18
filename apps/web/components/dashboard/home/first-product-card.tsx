"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { AgentAssistantOption } from "@/components/agent-connections/agent-assistant-option";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import type { McpEndpoint } from "@/lib/agent-connections/mcp-endpoint";

interface FirstProductCardProps {
  /** Where an assistant connects, when the home still offers one; null otherwise. */
  assistant: McpEndpoint | null;
  className?: string;
}

/**
 * The home's next step while the store has nothing to rent: add a product,
 * or let an AI assistant set the store up.
 */
export const FirstProductCard = ({ assistant, className }: FirstProductCardProps) => {
  const t = useTranslations("dashboard.home");

  return (
    <div className={cn("bg-card ring-border rounded-2xl p-4 ring-1 ring-inset", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <DashboardIconTile icon={ProductSolidIcon} accent="primary" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{t("nextStep.firstProduct.title")}</p>
            <p className="text-muted-foreground text-sm">
              {t("nextStep.firstProduct.description")}
            </p>
          </div>
        </div>
        <Button className="shrink-0 max-sm:self-end" render={<Link href="/dashboard/products/new" />}>
          {t("header.cta.addFirstProduct")}
          <ArrowRight />
        </Button>
      </div>
      {assistant && (
        <AgentAssistantOption {...assistant} className="mt-3 border-t pt-3" />
      )}
    </div>
  );
};
