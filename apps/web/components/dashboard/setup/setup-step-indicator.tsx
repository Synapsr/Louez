"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { cn } from "@louez/utils";

const EASE_OUT_CUBIC = [0.215, 0.61, 0.355, 1] as const;

interface SetupStepIndicatorProps {
  completed: boolean;
  isCurrent: boolean;
  index: number;
  reducedMotion: boolean;
}

/** The dashed dot in front of a setup step, ticked once the step is done. */
export const SetupStepIndicator = ({
  completed,
  isCurrent,
  index,
  reducedMotion,
}: SetupStepIndicatorProps) => (
  <span
    className={cn(
      "flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-[10px] font-medium tabular-nums",
      completed
        ? "bg-primary/10 text-primary border-primary"
        : isCurrent
          ? "border-primary text-muted-foreground"
          : "border-border text-muted-foreground",
    )}
  >
    {completed ? (
      <motion.span
        initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: EASE_OUT_CUBIC, delay: index * 0.04 }}
        className="flex"
      >
        <Check className="size-3" strokeWidth={3} />
      </motion.span>
    ) : null}
  </span>
);
