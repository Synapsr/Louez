"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@louez/utils";

import { Input } from "./input";

interface InputPriceProps {
  value: number;
  onChange: (value: number) => void;
  /** Unit hint rendered inside the field (e.g. "€", "€/j") */
  suffix: string;
  ariaLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Value restored when the user presses Escape */
  revertValue?: number;
  /** Called after the value is committed (blur or Enter) */
  onCommit?: () => void;
  /** Called when the user cancels with Escape */
  onCancel?: () => void;
  className?: string;
}

function InputPrice({
  value,
  onChange,
  suffix,
  ariaLabel,
  disabled,
  autoFocus,
  revertValue,
  onCommit,
  onCancel,
  className,
}: InputPriceProps) {
  const [localValue, setLocalValue] = useState(value.toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalValue(value.toFixed(2));
    }
  }, [value]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="relative cursor-text"
      // Focus the input when the padding or suffix area is clicked
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <Input
        ref={inputRef}
        inputMode="decimal"
        value={localValue}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "" || /^\d*[.,]?\d{0,2}$/.test(raw)) {
            setLocalValue(raw);
            const parsed = parseFloat(raw.replace(",", "."));
            if (!Number.isNaN(parsed)) {
              onChange(parsed);
            }
          }
        }}
        onBlur={() => {
          const parsed = parseFloat(localValue.replace(",", "."));
          const final = Number.isNaN(parsed) ? 0 : parsed;
          setLocalValue(final.toFixed(2));
          onChange(final);
          onCommit?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            const resetValue = revertValue ?? value;
            setLocalValue(resetValue.toFixed(2));
            onChange(resetValue);
            onCancel?.();
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            const parsed = parseFloat(localValue.replace(",", "."));
            const final = Number.isNaN(parsed) ? 0 : parsed;
            setLocalValue(final.toFixed(2));
            onChange(final);
            onCommit?.();
          }
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={cn("h-auto w-28 *:pr-0  *:min-w-0 pr-8 text-right tabular-nums", className)}
      />
      <span
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs select-none"
        aria-hidden="true"
      >
        {suffix}
      </span>
    </div>
  );
}

export { InputPrice, type InputPriceProps };
