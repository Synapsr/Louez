"use client";

import { NumberField } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";

import { cn } from "@louez/utils";

import { Button } from "./button";

interface InputQuantityProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Editable number input between the buttons; a read-only value otherwise */
  editable?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}

function InputQuantity({
  value,
  onChange,
  min = 1,
  max,
  editable = true,
  disabled,
  ariaLabel,
  className,
}: InputQuantityProps) {
  return (
    <NumberField.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
      min={min}
      max={max}
      disabled={disabled}
      readOnly={!editable}
      className={className}
    >
      <NumberField.Group className="flex items-center h-9">
        <NumberField.Decrement
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 rounded-r-none"
              aria-label={`${ariaLabel} −1`}
            />
          }
        >
          <Minus data-slot="icon" className="size-3" />
        </NumberField.Decrement>
        <NumberField.Input
          aria-label={ariaLabel}
          className={cn(
            "relative h-full text-center text-base tabular-nums outline-none sm:text-sm",
            editable
              ? "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/24 -mx-px w-14 border focus-visible:z-10 focus-visible:ring-[3px]"
              : "w-8 border-0 bg-transparent font-medium",
          )}
        />
        <NumberField.Increment
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 rounded-l-none"
              aria-label={`${ariaLabel} +1`}
            />
          }
        >
          <Plus data-slot="icon" className="size-3" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

export { InputQuantity, type InputQuantityProps };
