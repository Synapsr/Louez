"use client";

import { cn } from "@louez/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Key, ReactNode } from "react";

type Props = {
  activeKey: Key;
  children: ReactNode;
  className?: string;
  exitScale?: number;
  "data-icon"?: string;
};

export function AnimatedIconSwap({
  activeKey,
  children,
  className,
  exitScale = 0.4,
  "data-icon": dataIcon,
}: Props) {
  const shouldReduceMotion = useReducedMotion();

  const motionState = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: exitScale, filter: "blur(4px)" };

  const visibleState = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, filter: "blur(0px)" };

  return (
    <span data-icon={dataIcon} className={cn("relative size-[18px]", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={activeKey}
          initial={motionState}
          animate={visibleState}
          exit={motionState}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
