"use client";

import { useState } from "react";

import { PenLine } from "lucide-react";

import { Badge, Button, InputPrice, Tooltip, TooltipContent, TooltipTrigger } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";

interface TotalPriceEditorProps {
  value: number;
  savings: number;
  isManual?: boolean;
  currencySymbol: string;
  /** The reservation's currency, the amounts shown in it. */
  currency: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}

export function TotalPriceEditor({
  value,
  savings,
  isManual,
  currencySymbol,
  currency,
  ariaLabel,
  onChange,
}: TotalPriceEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { intl: formatLocale } = useFormatLocale();

  if (isEditing) {
    return (
      <div className="relative flex w-32 justify-end">
        <InputPrice
          value={value}
          onValueCommitted={(next) => {
            onChange(next);
            setIsEditing(false);
          }}
          suffix={currencySymbol}
          ariaLabel={ariaLabel}
          autoFocus
          onCancel={() => setIsEditing(false)}
          className={cn(isManual && "border-amber-300 bg-amber-50 dark:bg-amber-950/20")}
        />
      </div>
    );
  }

  return (
    <div className="flex w-32 flex-col items-end">
      <div className="flex h-9 items-center justify-end gap-1">
        <p className="font-semibold tabular-nums">
          {formatCurrency(value, currency, formatLocale)}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-7 w-7 shrink-0"
                onClick={() => setIsEditing(true)}
              />
            }
          >
            <PenLine className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{ariaLabel}</TooltipContent>
        </Tooltip>
      </div>
      {savings > 0 && !isManual && (
        <Badge variant="success" className="text-[10px] tabular-nums">
          -{formatCurrency(savings, currency, formatLocale)}
        </Badge>
      )}
    </div>
  );
}
