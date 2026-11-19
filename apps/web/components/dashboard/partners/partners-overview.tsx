"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Handshake, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { PartnerList } from "@louez/api/contracts/partners";
import { Badge, Button, Card, CardPanel } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { partnersQueries } from "@/lib/queries/partners.queries";

import { PartnerFormDialog } from "./partner-form-dialog";
import { PartnerSettingsDialog } from "./partner-settings-dialog";
import { usePartnersAnalytics } from "./use-partners-analytics";
import { formatPartnerRule } from "./util.partner-rule";

interface PartnersOverviewProps {
  storeId: string;
  initialList: PartnerList;
}

/**
 * « Partenaires »: the store's partners, each with what its link brought
 * this month and what the store owes it. A partner opens its own page.
 */
export const PartnersOverview = ({ storeId, initialList }: PartnersOverviewProps) => {
  const t = useTranslations("dashboard.partners");
  const format = useFormatter();
  const analytics = usePartnersAnalytics(storeId);
  const { data: list } = useQuery({ ...partnersQueries.list(), initialData: initialList });
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.viewed("list", initialList.partners.length);
  }, [analytics, initialList.partners.length]);

  const [year, month] = list.month.split("-").map(Number);
  const monthLabel = format.dateTime(new Date(year, month - 1, 1), {
    month: "long",
    year: "numeric",
  });
  const remaining = list.partners.reduce(
    (sum, partner) => sum + Math.max(0, partner.totals.remaining),
    0,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("description")}</p>
        </div>
        {list.partners.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            {t("add")}
          </Button>
        )}
      </div>

      {list.partners.length === 0 ? (
        <Card className="items-center pb-8">
          <DashboardEmptyState
            icon={Handshake}
            title={t("empty.title")}
            description={t("empty.description")}
          />
          <ol className="text-muted-foreground mx-auto max-w-md list-decimal space-y-1 px-6 pl-10 text-sm">
            <li>{t("empty.steps.add")}</li>
            <li>{t("empty.steps.share")}</li>
            <li>{t("empty.steps.pay")}</li>
          </ol>
          <Button className="mt-2" onClick={() => setAdding(true)}>
            <Plus />
            {t("add")}
          </Button>
        </Card>
      ) : (
        <Card>
          <CardPanel className="space-y-1 p-0">
            <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <span className="text-muted-foreground text-sm first-letter:uppercase">
                {monthLabel}
              </span>
              <span className="text-sm">
                {t("toPay")}{" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(remaining, list.currency)}
                </span>
              </span>
            </div>
            <ul className="divide-y">
              {list.partners.map((partner) => (
                <li key={partner.id}>
                  <Link
                    href={`/dashboard/visibility/partners/${partner.id}`}
                    className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{partner.name}</span>
                        {partner.archived && <Badge variant="tertiary">{t("archived")}</Badge>}
                      </div>
                      <p className="text-muted-foreground truncate text-sm">
                        {formatPartnerRule(partner.commission, list.currency, t)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="tabular-nums">
                        {t("bookings", { count: partner.totals.bookings })}
                      </p>
                      {partner.totals.remaining > 0 && (
                        <p className="text-muted-foreground tabular-nums">
                          {t("dueAmount", {
                            amount: formatCurrency(partner.totals.remaining, list.currency),
                          })}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardPanel>
        </Card>
      )}

      {list.partners.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {t("window", { count: list.settings.attributionDays })}{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-4"
            onClick={() => setSettingsOpen(true)}
          >
            {t("changeWindow")}
          </button>
        </p>
      )}

      <PartnerFormDialog
        storeId={storeId}
        currency={list.currency}
        open={adding}
        onOpenChange={setAdding}
        partner={null}
        promoCodes={list.promoCodes}
      />
      <PartnerSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        attributionDays={list.settings.attributionDays}
      />
    </div>
  );
};
