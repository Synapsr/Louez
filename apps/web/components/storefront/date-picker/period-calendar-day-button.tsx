"use client";

import { useContext, type ComponentProps } from "react";
import { differenceInCalendarDays } from "date-fns";
import { CalendarDayButton } from "@louez/ui/components/calendar";
import { PeriodInteractionContext } from "./period-interaction-context";

/** Reuse the calendar button, with an opt-out for its imperative focus effect. */
export const PeriodCalendarDayButton = ({
  day,
  modifiers,
  ...props
}: ComponentProps<typeof CalendarDayButton>) => {
  const { autoFocus, dateReference } = useContext(PeriodInteractionContext);
  return (
    <CalendarDayButton
      {...props}
      day={day}
      modifiers={autoFocus ? modifiers : { ...modifiers, focused: false }}
      data-period-day-offset={
        dateReference ? differenceInCalendarDays(day.date, dateReference) : undefined
      }
      data-period-outside={Boolean(modifiers.outside)}
    />
  );
};
