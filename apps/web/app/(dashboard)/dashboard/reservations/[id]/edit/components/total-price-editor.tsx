"use client";

import { useState } from "react";

import { PenLine } from "lucide-react";

import { Badge, Button, InputPrice, Tooltip, TooltipContent, TooltipTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

interface TotalPriceEditorProps {
  value: number;
  savings: number;
  isManual?: boolean;
  currencySymbol: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}

export function TotalPriceEditor({
  value,
  savings,
  isManual,
  currencySymbol,
  ariaLabel,
  onChange,
}: TotalPriceEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editStartValue, setEditStartValue] = useState(value);

  if (isEditing) {
    return (
      <div className="relative flex w-32 justify-end">
        <InputPrice
          value={value}
          onChange={onChange}
          suffix={currencySymbol}
          ariaLabel={ariaLabel}
          autoFocus
          revertValue={editStartValue}
          onCommit={() => setIsEditing(false)}
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
          {value.toFixed(2)}
          {currencySymbol}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-7 w-7 shrink-0"
                onClick={() => {
                  setEditStartValue(value);
                  setIsEditing(true);
                }}
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
          -{savings.toFixed(2)}
          {currencySymbol}
        </Badge>
      )}
    </div>
  );
}
