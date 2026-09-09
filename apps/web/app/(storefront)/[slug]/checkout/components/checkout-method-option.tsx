"use client";

import { Radio } from "@louez/ui";
import { cn } from "@louez/utils";

interface CheckoutMethodOptionProps {
  /** Radio value inside the enclosing `RadioGroup`. */
  value: string;
  label: string;
  /** What the option costs, shown beside the label. */
  price: string;
  /** Free options get the success colour, priced ones stay neutral. */
  isFree?: boolean;
  isSelected: boolean;
  isDisabled?: boolean;
}

/**
 * One way to receive or return the equipment, carrying its own price so the
 * cost of each option is legible before it is chosen rather than after.
 */
export const CheckoutMethodOption = ({
  value,
  label,
  price,
  isFree = false,
  isSelected,
  isDisabled = false,
}: CheckoutMethodOptionProps) => (
  <label
    className={cn(
      "flex cursor-pointer items-center gap-2 rounded-full py-1.5 pe-1.5 ps-3 text-xs font-medium transition-colors duration-150 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-50 motion-reduce:transition-none",
      isSelected ? "bg-foreground text-background" : "bg-muted hover:bg-accent",
    )}
  >
    <span className="sr-only">
      <Radio value={value} disabled={isDisabled} />
    </span>
    {label}
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        isSelected
          ? isFree
            ? "bg-success/25 text-background"
            : "bg-background/20 text-background"
          : isFree
            ? "bg-success/15 text-success"
            : "bg-background text-muted-foreground",
      )}
    >
      {price}
    </span>
  </label>
);
