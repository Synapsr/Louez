"use client";

import type { ReactNode } from "react";

import { Radio, RadioGroup } from "@louez/ui";
import { cn } from "@louez/utils";

interface PanelTileOption<TValue extends string> {
  value: TValue;
  label: string;
  /** The thumbnail drawn in the tile. */
  preview: ReactNode;
}

interface PanelTilePickerProps<TValue extends string> {
  /** `null` selects no tile, for settings that no longer match any option. */
  value: TValue | null;
  options: ReadonlyArray<PanelTileOption<TValue>>;
  onChange: (next: TValue) => void;
  columns?: 2 | 3;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

const COLUMN_CLASS_NAMES = {
  2: "grid-cols-2",
  3: "grid-cols-3",
} as const;

/** A choice between shapes, shown as thumbnails with a short name under each. */
export const PanelTilePicker = <TValue extends string>({
  value,
  options,
  onChange,
  columns = 2,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: PanelTilePickerProps<TValue>) => (
  <RadioGroup
    value={value ?? ""}
    onValueChange={(next) => {
      const option = options.find((candidate) => candidate.value === next);
      if (option) onChange(option.value);
    }}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    className={cn("grid gap-2", COLUMN_CLASS_NAMES[columns])}
  >
    {options.map((option) => (
      <label key={option.value} className="group/tile flex min-w-0 cursor-pointer flex-col gap-1.5">
        <span className="sr-only">
          <Radio value={option.value} />
        </span>
        <span className="block rounded-lg ring-1 ring-border transition-shadow group-hover/tile:ring-foreground/30 group-has-focus-visible/tile:ring-2 group-has-focus-visible/tile:ring-ring group-has-data-checked/tile:ring-2 group-has-data-checked/tile:ring-primary">
          {option.preview}
        </span>
        <span className="truncate text-center text-muted-foreground text-xs group-has-data-checked/tile:font-medium group-has-data-checked/tile:text-foreground">
          {option.label}
        </span>
      </label>
    ))}
  </RadioGroup>
);
