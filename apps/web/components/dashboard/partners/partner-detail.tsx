"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { log } from "evlog/next/client";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { PartnerStatementView } from "@louez/api/contracts/partners";
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toastManager,
} from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import { partnerStatementUrl } from "@/lib/partners/partner-statement-path";
import { partnerLinkUrl } from "@/lib/partners/util.partner-link";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

import { PartnerFormDialog } from "./partner-form-dialog";
import { PartnerLinkCard } from "./partner-link-card";
import { PartnerStatementCard } from "./partner-statement-card";
import { usePartnersAnalytics } from "./use-partners-analytics";
import { formatPartnerRule } from "./util.partner-rule";

interface PartnerDetailProps {
  storeId: string;
  storeName: string;
  storeUrl: string;
  appUrl: string;
  initialStatement: PartnerStatementView;
}

/**
 * A partner's page: its link (copy, QR poster, send), then the month's
 * statement; editing, the statement page's link and archiving in a menu.
 */
export const PartnerDetail = ({
  storeId,
  storeName,
  storeUrl,
  appUrl,
  initialStatement,
}: PartnerDetailProps) => {
  const t = useTranslations("dashboard.partners");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const analytics = usePartnersAnalytics(storeId);
  const partnerId = initialStatement.partner.id;
  const [month, setMonth] = useState(initialStatement.month);
  const [editing, setEditing] = useState(false);

  const { data: statement } = useQuery({
    ...partnersQueries.statement(partnerId, month),
    initialData: month === initialStatement.month ? initialStatement : undefined,
    placeholderData: keepPreviousData,
  });
  const view = statement ?? initialStatement;
  const { partner, currency } = view;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.viewed("partner", 1);
  }, [analytics]);

  const onError = (error: unknown) => {
    const key = apiErrorKey(error);
    toastManager.add({
      title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: partnersQueries.key() });

  const setArchived = useMutation({
    ...partnersMutations.setArchived(),
    onSuccess: () => void refresh(),
    onError,
  });
  const rotate = useMutation({
    ...partnersMutations.rotateStatementToken(),
    onSuccess: () => {
      toastManager.add({ title: t("menu.rotated"), type: "success" });
      void refresh();
    },
    onError,
  });

  const link = partnerLinkUrl(storeUrl, partner.code);
  const statementUrl = partnerStatementUrl(appUrl, view.statementToken);
  const rule = formatPartnerRule(partner.commission, currency, t);

  const copyStatementLink = async () => {
    try {
      await navigator.clipboard.writeText(statementUrl);
      analytics.linkShared("statement_link");
      toastManager.add({ title: t("menu.statementCopied"), type: "success" });
    } catch (error) {
      log.warn({ action: "partner_statement_copy_failed", error: String(error) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          render={<Link href="/dashboard/visibility/partners" />}
        >
          <ArrowLeft />
          {t("title")}
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">{partner.name}</h1>
            <p className="text-muted-foreground mt-1">{rule}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" aria-label={t("menu.label")} />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                {t("menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copyStatementLink()}>
                <Link2 className="size-4" />
                {t("menu.copyStatement")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => rotate.mutate({ partnerId })}>
                <RefreshCw className="size-4" />
                {t("menu.rotateStatement")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setArchived.mutate({ partnerId, archived: !partner.archived })}
              >
                {partner.archived ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {partner.archived ? t("menu.restore") : t("menu.archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {partner.archived && (
        <Alert>
          <AlertDescription>{t("archivedNotice")}</AlertDescription>
        </Alert>
      )}

      {!partner.archived && (
        <PartnerLinkCard
          partner={partner}
          storeName={storeName}
          link={link}
          message={t("link.message", { store: storeName, link, rule, statement: statementUrl })}
          onShared={analytics.linkShared}
        />
      )}

      <PartnerStatementCard
        statement={view}
        months={view.months}
        onMonthChange={setMonth}
        analytics={analytics}
      />

      <PartnerFormDialog
        storeId={storeId}
        currency={currency}
        open={editing}
        onOpenChange={setEditing}
        partner={partner}
      />
    </div>
  );
};
