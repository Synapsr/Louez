"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@louez/utils";

import { useMeasuredHeight } from "@/hooks/use-measured-height";

interface EmbedCollapseProps {
  open: boolean;
  /** Changing the key crossfades the content while the height follows. */
  contentKey: string;
  children: ReactNode;
  className?: string;
}

// A strong ease-out: the panel lands quickly, the iframe grows with it.
const heightTransition = { duration: 0.27, ease: [0.25, 1, 0.5, 1] } as const;

/**
 * Unfolds to its content's height and folds to nothing. Folded, the
 * content is inert so a keyboard cannot reach what the eye cannot see.
 */
export const EmbedCollapse = ({ open, contentKey, children, className }: EmbedCollapseProps) => {
  const reduceMotion = useReducedMotion();
  const [ref, height] = useMeasuredHeight<HTMLDivElement>();

  return (
    <motion.div
      initial={false}
      animate={{ height: open ? (height ?? "auto") : 0, opacity: open ? 1 : 0 }}
      transition={reduceMotion ? { duration: 0.15 } : heightTransition}
      aria-hidden={!open}
      inert={!open}
      className={cn("overflow-hidden", className)}
    >
      <div ref={ref}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, filter: reduceMotion ? "none" : "blur(2px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: reduceMotion ? "none" : "blur(2px)" }}
            transition={{ duration: 0.18 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
