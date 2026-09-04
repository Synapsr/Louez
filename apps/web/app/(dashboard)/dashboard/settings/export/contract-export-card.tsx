"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  toastManager,
} from "@louez/ui";
import { DownloadIcon, FileTextIcon } from "@louez/ui/icons";
import type { ReservationStatus } from "@louez/validations";

import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  formatExportCalendarDate,
  isExportDateRangeWithinLimit,
  isValidExportDateRange,
} from "@/lib/export/date-range";
import { triggerExportDownload } from "@/lib/export/download";
import { contractExportStatuses } from "@/lib/export/types";

interface ContractExportCardProps {
  timezone?: string;
}

export const ContractExportCard = ({ timezone }: ContractExportCardProps) => {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<ReservationStatus>>(
    () => new Set(contractExportStatuses),
  );
  const [isExporting, setIsExporting] = useState(false);

  const allStatusesSelected = selectedStatuses.size === contractExportStatuses.length;
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected;

  const toggleStatus = (status: ReservationStatus) => {
    setSelectedStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const toggleAllStatuses = () => {
    setSelectedStatuses(
      allStatusesSelected ? new Set<ReservationStatus>() : new Set(contractExportStatuses),
    );
  };

  const handleExport = async () => {
    if (!startDate || !endDate) {
      toastManager.add({
        title: t("settings.export.errors.dateRequired"),
        type: "error",
      });
      return;
    }

    const startDateValue = formatExportCalendarDate(startDate, timezone);
    const endDateValue = formatExportCalendarDate(endDate, timezone);

    if (!isValidExportDateRange(startDateValue, endDateValue)) {
      toastManager.add({
        title: t("settings.export.errors.invalidDateRange"),
        type: "error",
      });
      return;
    }

    if (!isExportDateRangeWithinLimit(startDateValue, endDateValue)) {
      toastManager.add({ title: t("settings.export.errors.maxRange"), type: "error" });
      return;
    }

    if (selectedStatuses.size === 0) {
      toastManager.add({
        title: t("settings.export.errors.statusRequired"),
        type: "error",
      });
      return;
    }

    setIsExporting(true);

    try {
      const params = new URLSearchParams({
        startDate: startDateValue,
        endDate: endDateValue,
        locale: locale === "en" ? "en" : "fr",
      });
      for (const status of contractExportStatuses) {
        if (selectedStatuses.has(status)) params.append("status", status);
      }

      const response = await fetch(`/api/export/contracts?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 404) {
          toastManager.add({
            title: t("settings.export.errors.noContracts"),
            type: "info",
          });
          return;
        }
        throw new Error(response.statusText);
      }

      await triggerExportDownload(response, "contracts.zip");
    } catch {
      toastManager.add({
        title: t("settings.export.errors.exportFailed"),
        type: "error",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileTextIcon className="h-5 w-5 shrink-0" />
          {t("settings.export.contracts.title")}
        </CardTitle>
        <CardDescription>{t("settings.export.contracts.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.export.dateRange.startDate")}</Label>
            <DateTimePicker
              date={startDate}
              setDate={setStartDate}
              showTime={false}
              timezone={timezone}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.export.dateRange.endDate")}</Label>
            <DateTimePicker
              date={endDate}
              setDate={setEndDate}
              showTime={false}
              timezone={timezone}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs">{t("settings.export.contracts.statusesLabel")}</Label>
            <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground">
              <Checkbox
                checked={allStatusesSelected}
                indeterminate={someStatusesSelected}
                onCheckedChange={toggleAllStatuses}
              />
              {allStatusesSelected
                ? t("settings.export.contracts.clearAll")
                : t("settings.export.contracts.selectAll")}
            </Label>
          </div>
          <div className="grid gap-1 rounded-lg border p-2 sm:grid-cols-2 lg:grid-cols-4">
            {contractExportStatuses.map((status) => (
              <Label
                key={status}
                className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal"
              >
                <Checkbox
                  checked={selectedStatuses.has(status)}
                  onCheckedChange={() => toggleStatus(status)}
                />
                <span>{t(`calendar.status.${status}`)}</span>
              </Label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.export.format.label")}</Label>
            <p className="text-sm text-muted-foreground">{t("settings.export.contracts.format")}</p>
          </div>
          <Button
            onClick={handleExport}
            isPending={isExporting}
            pendingContent={t("settings.export.contracts.exporting")}
            className="sm:shrink-0"
          >
            <DownloadIcon className="mr-2 h-4 w-4" />
            {t("settings.export.contracts.button")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
