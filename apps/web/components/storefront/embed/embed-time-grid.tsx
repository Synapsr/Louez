"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { groupEmbedSlots } from "./util.embed-slots";

interface EmbedTimeGridProps {
  slots: string[];
  intervalMinutes: number;
  value: string;
  onSelect: (time: string) => void;
}

const pillTransition = { type: "spring", duration: 0.3, bounce: 0 } as const;

/**
 * The slots of a day laid out like the calendar: one block per opening
 * range, chips in columns, so the hour step keeps the shape and height of
 * the day step and the panel does not jump between the two.
 */
export const EmbedTimeGrid = ({ slots, intervalMinutes, value, onSelect }: EmbedTimeGridProps) => {
  const t = useTranslations("storefront.embed");
  const tHours = useTranslations("storefront.dateSelection.businessHours");
  const id = useId();
  const reduceMotion = useReducedMotion();
  const groups = groupEmbedSlots(slots, intervalMinutes);

  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">{tHours("storeClosed")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3" role="radiogroup">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          {groups.length > 1 ? (
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(`slotGroups.${group.period}`)}
            </span>
          ) : null}
          <div className="grid grid-cols-4 gap-1.5 @[24rem]:grid-cols-5">
            {group.slots.map((slot) => {
              const selected = slot === value;
              return (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(slot)}
                  className={cn(
                    "relative h-9 rounded-lg text-sm tabular-nums transition-[color,transform] duration-150 active:scale-95",
                    selected
                      ? "font-semibold text-primary-foreground"
                      : "bg-muted/60 text-foreground hover:bg-muted",
                  )}
                >
                  {selected ? (
                    <motion.span
                      layoutId={`${id}-pill`}
                      transition={reduceMotion ? { duration: 0 } : pillTransition}
                      aria-hidden
                      className="absolute inset-0 rounded-lg bg-primary"
                    />
                  ) : null}
                  <span className="relative">{slot}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
