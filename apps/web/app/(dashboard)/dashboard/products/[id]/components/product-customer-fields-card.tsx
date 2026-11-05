"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Globe, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { orpc } from "@/lib/orpc/react";

import { productCardFields } from "./util.product-customer-fields";

interface ProductCustomerFieldsCardProps {
  productId: string;
}

/**
 * The custom fields that concern this product, in editor order: asked online
 * for it, or recorded on each of its rented units. Nothing concerns it: no card.
 */
export const ProductCustomerFieldsCard = ({ productId }: ProductCustomerFieldsCardProps) => {
  const t = useTranslations("dashboard.products.detail.customerFields");
  const { data: fields } = useQuery(
    orpc.dashboard.customerFields.forProduct.queryOptions({
      input: { productId },
      select: (all) => productCardFields(all),
    }),
  );

  if (!fields || fields.length === 0) return null;

  return (
    <DashboardSectionCard title={t("title")} description={t("description")}>
      <ul className="divide-y">
        {fields.map((field) => (
          <li
            key={field.id}
            className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{field.label}</p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                {field.collectMode === "never" ? (
                  <Users aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <Globe aria-hidden className="size-3.5 shrink-0" />
                )}
                {t(`collect.${field.collectMode}`)}
              </p>
            </div>
            <Badge variant="secondary" size="sm" className="mt-0.5">
              {t(`scope.${field.scope}`)}
            </Badge>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-4 w-full"
        render={<Link href="/dashboard/settings/customer-fields" />}
      >
        {t("manage")}
        <ArrowRight aria-hidden className="size-4" />
      </Button>
    </DashboardSectionCard>
  );
};
