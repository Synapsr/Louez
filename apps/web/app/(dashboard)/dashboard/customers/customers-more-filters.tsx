"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CUSTOMER_ACQUISITION_SOURCES, CUSTOMER_CREATED_VIA } from "@louez/types";
import {
  Badge,
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";

export interface CustomersMoreFiltersValue {
  source: string;
  channel: string;
  createdFrom: string;
  createdTo: string;
}

interface CustomersMoreFiltersProps {
  value: CustomersMoreFiltersValue;
  onChange: (changes: Partial<CustomersMoreFiltersValue>) => void;
}

const ALL = "all";

/** The filters used now and then, kept one click away so the list header stays short. */
export const CustomersMoreFilters = ({ value, onChange }: CustomersMoreFiltersProps) => {
  const t = useTranslations("dashboard.customers");
  const activeCount = Object.values(value).filter(Boolean).length;

  const sourceOptions = [
    { value: ALL, label: t("filter.allSources") },
    ...CUSTOMER_ACQUISITION_SOURCES.map((source) => ({
      value: source,
      label: t(`sources.${source}`),
    })),
  ];
  const channelOptions = [
    { value: ALL, label: t("filter.allChannels") },
    ...CUSTOMER_CREATED_VIA.map((channel) => ({ value: channel, label: t(`channels.${channel}`) })),
  ];

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="w-full sm:w-auto" />}>
        <SlidersHorizontal className="size-4" />
        {t("filter.more")}
        {activeCount > 0 && (
          <Badge variant="secondary" size="sm">
            {activeCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-2">
          <Label>{t("filter.created")}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label={t("filter.createdFrom")}
              value={value.createdFrom}
              max={value.createdTo || undefined}
              onChange={(event) => onChange({ createdFrom: event.target.value })}
            />
            <Input
              type="date"
              aria-label={t("filter.createdTo")}
              value={value.createdTo}
              min={value.createdFrom || undefined}
              onChange={(event) => onChange({ createdTo: event.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customers-filter-source">{t("filter.source")}</Label>
          <Select
            items={sourceOptions}
            value={value.source || ALL}
            onValueChange={(next) => onChange({ source: !next || next === ALL ? "" : next })}
          >
            <SelectTrigger id="customers-filter-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customers-filter-channel">{t("filter.channel")}</Label>
          <Select
            items={channelOptions}
            value={value.channel || ALL}
            onValueChange={(next) => onChange({ channel: !next || next === ALL ? "" : next })}
          >
            <SelectTrigger id="customers-filter-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
};
