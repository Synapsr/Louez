"use client";

import { ClockIcon } from "lucide-react";

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

interface TimeSelectFieldProps {
  id: string;
  label: string;
  slots: string[];
  value: string;
  onSelect: (time: string) => void;
  /** Shown in the trigger when the day has no slot (store closed). */
  emptyMessage: string;
  disabled?: boolean;
  /** `inline`: label beside the select (popover); `stacked`: label above a full-width select (sheet). */
  layout?: "inline" | "stacked";
  className?: string;
}

/** One time field ("Retrait 09:00"), the same select the dashboard picker uses. */
export const TimeSelectField = ({
  id,
  label,
  slots,
  value,
  onSelect,
  emptyMessage,
  disabled = false,
  layout = "inline",
  className,
}: TimeSelectFieldProps) => {
  const isEmpty = slots.length === 0;
  const stacked = layout === "stacked";

  return (
    <div
      className={cn(
        "flex min-w-0 gap-2",
        stacked ? "flex-col items-stretch gap-1.5" : "items-center",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      </div>
      <Select
        value={isEmpty ? null : value}
        onValueChange={(time: string | null) => {
          if (time) onSelect(time);
        }}
        disabled={disabled || isEmpty}
      >
        <SelectTrigger
          id={id}
          className={cn("h-11 tabular-nums sm:h-9", stacked ? "w-full" : "w-28")}
        >
          <SelectValue placeholder="--:--">{isEmpty ? emptyMessage : value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {slots.map((time) => (
            <SelectItem key={time} value={time} label={time}>
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
