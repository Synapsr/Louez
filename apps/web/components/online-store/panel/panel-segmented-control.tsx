"use client";

import type { ComponentType } from "react";

import { Radio, RadioGroup } from "@louez/ui";

interface PanelSegmentedOption<TValue extends string> {
  value: TValue;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface PanelSegmentedControlProps<TValue extends string> {
  value: TValue;
  options: ReadonlyArray<PanelSegmentedOption<TValue>>;
  onChange: (next: TValue) => void;
  "aria-label"?: string;
}

/**
 * A short choice as one strip of segments. Still a radio group underneath,
 * so arrow keys move the choice and a screen reader announces it.
 */
export const PanelSegmentedControl = <TValue extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: PanelSegmentedControlProps<TValue>) => (
  <RadioGroup
    value={value}
    onValueChange={(next) => {
      const option = options.find((candidate) => candidate.value === next);
      if (option) onChange(option.value);
    }}
    aria-label={ariaLabel}
    className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-muted p-0.5"
  >
    {options.map(({ value: optionValue, label, icon: Icon }) => (
      <label
        key={optionValue}
        className="flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:bg-background has-data-checked:text-foreground has-data-checked:shadow-xs"
      >
        <span className="sr-only">
          <Radio value={optionValue} />
        </span>
        {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </label>
    ))}
  </RadioGroup>
);
