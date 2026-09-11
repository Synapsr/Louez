"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarIcon, ClockIcon } from "lucide-react";

import { cn } from "@louez/utils";

import type { EmbedPeriodPart } from "./util.embed-period-steps";

interface EmbedPeriodFieldProps {
  label: string;
  /** "12 sept.", or the placeholder while empty. */
  day: string;
  /** "12/09": the same day for hosts narrower than 20.5rem, where the long form no longer fits beside the time. */
  dayCompact: string;
  time: string;
  /** No day yet: the field reads as a placeholder. */
  empty: boolean;
  /** The half whose editor is open. */
  active: EmbedPeriodPart | null;
  onTap: (part: EmbedPeriodPart) => void;
}

const swapTransition = { type: "spring", duration: 0.3, bounce: 0 } as const;

/**
 * One field of the embed widget ("Retrait" / "Retour") split in two tap
 * targets: the day on the left, the time on the right. The tapped half
 * lights up while its editor is open under the fields.
 */
export const EmbedPeriodField = ({
  label,
  day,
  dayCompact,
  time,
  empty,
  active,
  onTap,
}: EmbedPeriodFieldProps) => {
  const reduceMotion = useReducedMotion();
  const lift = reduceMotion ? 0 : 8;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div
        className={cn(
          "flex h-12 min-w-0 overflow-hidden rounded-xl border bg-background text-sm font-semibold transition-[border-color,box-shadow,color] duration-200 lg:h-11",
          empty && "text-muted-foreground",
          active ? "border-primary ring-3 ring-primary/15" : "hover:border-foreground/30",
        )}
      >
        <button
          type="button"
          aria-pressed={active === "date"}
          onClick={() => onTap("date")}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors duration-150",
            active === "date" ? "bg-primary/10" : "hover:bg-muted/60",
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-primary @max-[24rem]:hidden" aria-hidden />
          <span className="grid min-w-0 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={day}
                initial={{ opacity: 0, y: lift }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -lift }}
                transition={swapTransition}
                className="col-start-1 row-start-1 truncate"
              >
                <span className="@max-[20.5rem]:hidden">{day}</span>
                <span className="@min-[20.5rem]:hidden">{dayCompact}</span>
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
        <span aria-hidden className="my-2 w-px shrink-0 bg-border" />
        <button
          type="button"
          // A time without a day means nothing: the day comes first.
          disabled={empty}
          aria-pressed={active === "time"}
          onClick={() => onTap("time")}
          className={cn(
            "flex shrink-0 items-center gap-1.5 px-3 tabular-nums transition-colors duration-150 disabled:cursor-default",
            active === "time" ? "bg-primary/10" : "enabled:hover:bg-muted/60",
          )}
        >
          <ClockIcon
            className="size-4 shrink-0 text-muted-foreground @max-[24rem]:hidden"
            aria-hidden
          />
          <span className="grid overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={time}
                initial={{ opacity: 0, y: lift }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -lift }}
                transition={swapTransition}
                className="col-start-1 row-start-1"
              >
                {time}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
      </div>
    </div>
  );
};
