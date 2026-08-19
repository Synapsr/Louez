"use client";

import { useState, type ElementType } from "react";
import { useTranslations } from "next-intl";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  toastManager,
} from "@louez/ui";
import { DownloadIcon } from "@louez/ui/icons";

import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  formatExportCalendarDate,
  isExportDateRangeWithinLimit,
  isValidExportDateRange,
} from "@/lib/export/date-range";
import { triggerExportDownload } from "@/lib/export/download";
import type { ExportFormat, ExportType } from "@/lib/export/types";

interface TabularExportCardProps {
  type: ExportType;
  icon: ElementType;
  title: string;
  description: string;
  buttonLabel: string;
  showDateRange: boolean;
  timezone?: string;
}

export const TabularExportCard = ({
  type,
  icon: Icon,
  title,
  description,
  buttonLabel,
  showDateRange,
  timezone,
}: TabularExportCardProps) => {
  const t = useTranslations("dashboard.settings.export");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (showDateRange && (!startDate || !endDate)) {
      toastManager.add({ title: t("errors.dateRequired"), type: "error" });
      return;
    }

    const startDateValue = startDate ? formatExportCalendarDate(startDate, timezone) : undefined;
    const endDateValue = endDate ? formatExportCalendarDate(endDate, timezone) : undefined;

    if (showDateRange && startDateValue && endDateValue) {
      if (!isValidExportDateRange(startDateValue, endDateValue)) {
        toastManager.add({ title: t("errors.invalidDateRange"), type: "error" });
        return;
      }

      if (!isExportDateRangeWithinLimit(startDateValue, endDateValue)) {
        toastManager.add({ title: t("errors.maxRange"), type: "error" });
        return;
      }
    }

    setIsExporting(true);

    try {
      const params = new URLSearchParams({ type, format });
      if (startDateValue) params.set("startDate", startDateValue);
      if (endDateValue) params.set("endDate", endDateValue);

      const response = await fetch(`/api/export?${params.toString()}`);
      if (!response.ok) throw new Error(response.statusText);

      await triggerExportDownload(response, `export.${format}`);
    } catch {
      toastManager.add({ title: t("errors.exportFailed"), type: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {showDateRange && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">{t("dateRange.startDate")}</Label>
              <DateTimePicker
                date={startDate}
                setDate={setStartDate}
                showTime={false}
                timezone={timezone}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t("dateRange.endDate")}</Label>
              <DateTimePicker
                date={endDate}
                setDate={setEndDate}
                showTime={false}
                timezone={timezone}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Label className="text-xs">{t("format.label")}</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as ExportFormat)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="csv" id={`${type}-csv`} />
                <Label htmlFor={`${type}-csv`} className="cursor-pointer font-normal">
                  {t("format.csv")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="json" id={`${type}-json`} />
                <Label htmlFor={`${type}-json`} className="cursor-pointer font-normal">
                  {t("format.json")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Button
            onClick={handleExport}
            isPending={isExporting}
            pendingContent={t("exporting")}
            className="shrink-0"
          >
            <DownloadIcon className="mr-2 h-4 w-4" />
            {buttonLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
