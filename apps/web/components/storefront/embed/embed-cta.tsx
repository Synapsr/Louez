"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@louez/ui";

interface EmbedCtaProps {
  ready: boolean;
  label: string;
  /** Shown instead of the label while the period is missing or invalid. */
  hint: string;
  onClick: () => void;
}

const swapTransition = { type: "spring", duration: 0.3, bounce: 0 } as const;

/**
 * The one button of the widget. Its text crossfades between the hint and
 * the action, so the customer always knows what the next tap does.
 */
export const EmbedCta = ({ ready, label, hint, onClick }: EmbedCtaProps) => {
  const reduceMotion = useReducedMotion();
  const text = ready ? label : hint;
  const lift = reduceMotion ? 0 : 10;

  return (
    <Button
      size="xl"
      variant={ready ? "default" : "secondary"}
      className="w-full transition-[background-color,color,transform] duration-200 active:scale-[0.98]"
      onClick={onClick}
      aria-disabled={!ready}
    >
      <span className="relative grid overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={text}
            initial={{ opacity: 0, y: lift }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -lift }}
            transition={swapTransition}
            className="col-start-1 row-start-1 truncate"
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
      {ready ? <ArrowRightIcon data-icon="end" aria-hidden /> : null}
    </Button>
  );
};
