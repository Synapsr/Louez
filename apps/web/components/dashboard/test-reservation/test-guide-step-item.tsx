"use client";

import { Check } from "lucide-react";

import { cn } from "@louez/utils";

interface TestGuideStepItemProps {
  index: number;
  label: string;
  done: boolean;
  current: boolean;
}

/** One step of the test reservation's guide: its number, or a check once done. */
export const TestGuideStepItem = ({ index, label, done, current }: TestGuideStepItemProps) => (
  <li className="flex items-center gap-2">
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums",
        done
          ? "border-primary bg-primary/10 text-primary"
          : current
            ? "border-primary text-foreground"
            : "border-border text-muted-foreground",
      )}
    >
      {done ? <Check className="size-3" strokeWidth={3} /> : index}
    </span>
    <span className={cn("text-sm", done && "text-muted-foreground", current && "font-medium")}>
      {label}
    </span>
  </li>
);
