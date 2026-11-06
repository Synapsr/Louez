"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Download, FileSpreadsheet, Printer } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Menu, MenuItem, MenuPopup, MenuTrigger, Spinner, toastManager } from "@louez/ui";

import { triggerExportDownload } from "@/lib/export/download";
import type { DayRange } from "@/lib/utils/util.day-range";

interface FinancesExportMenuProps {
  range: DayRange;
  /** The CSV export is the owner's; the printout is for whoever closes the till. */
  canExportCsv: boolean;
  isPreparingPrint: boolean;
  onPrint: () => void;
}

export const FinancesExportMenu = ({
  range,
  canExportCsv,
  isPreparingPrint,
  onPrint,
}: FinancesExportMenuProps) => {
  const t = useTranslations("dashboard.finances.export");

  const csvExport = useMutation({
    mutationFn: async ({ from, to }: DayRange) => {
      const params = new URLSearchParams({
        type: "cashflow",
        format: "csv",
        startDate: from,
        endDate: to,
      });
      const response = await fetch(`/api/export?${params.toString()}`);
      if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
      await triggerExportDownload(response, `cashflow-${from}-to-${to}.csv`);
    },
    onError: () => toastManager.add({ title: t("csvError"), type: "error" }),
  });

  const isBusy = csvExport.isPending || isPreparingPrint;

  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" disabled={isBusy} />}>
        {isBusy ? <Spinner className="size-4" /> : <Download />}
        {isPreparingPrint ? t("preparing") : t("label")}
        <ChevronDown className="opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        {canExportCsv && (
          <MenuItem className="items-start" onClick={() => csvExport.mutate(range)}>
            <FileSpreadsheet className="mt-0.5" />
            <span className="flex flex-col">
              <span>{t("csv")}</span>
              <span className="text-muted-foreground text-xs">{t("csvHint")}</span>
            </span>
          </MenuItem>
        )}
        <MenuItem className="items-start" onClick={onPrint}>
          <Printer className="mt-0.5" />
          <span className="flex flex-col">
            <span>{t("print")}</span>
            <span className="text-muted-foreground text-xs">{t("printHint")}</span>
          </span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
};
