import type { BusinessHours, PricingMode } from "@louez/types";

import type { RentalPeriodValidation } from "@/lib/utils/util.rental-period";

/** A committed rental period: two instants (UTC), built in the store timezone. */
export interface RentalPeriodValue {
  start: Date;
  end: Date;
}

export type RentalPeriodField = "start" | "end";

export interface RentalDateCoreOptions {
  /** Instants (or ISO strings) the draft starts from; usually the committed period. */
  initialStart?: Date | string | null;
  initialEnd?: Date | string | null;
  pricingMode: PricingMode;
  minRentalMinutes: number;
  maxRentalMinutes?: number | null;
  businessHours?: BusinessHours;
  advanceNoticeMinutes?: number;
  /** Extra floor for the calendar, for callers that only know a minimum date. */
  minDate?: Date;
  timezone?: string;
  intervalMinutes?: number;
}

export interface RentalDateDraft {
  startDate?: Date;
  endDate?: Date;
  startTime: string;
  endTime: string;
  /** The end was filled by the default rule, not tapped: the next tap on or after the start sets it. */
  endIsAuto: boolean;
  activeField: RentalPeriodField | null;
}

export interface RentalDateCoreState extends RentalDateDraft {
  hasDates: boolean;
  isSameDay: boolean;
  minDate: Date;
  startTimeSlots: string[];
  endTimeSlots: string[];
  isDateDisabled: (date: Date) => boolean;
  openField: (field: RentalPeriodField) => void;
  closeField: () => void;
  /** Range-calendar tap: first tap starts, next tap on or after the start ends. */
  selectDay: (day: Date) => void;
  selectStartDate: (day: Date) => void;
  selectEndDate: (day: Date) => void;
  selectDays: (startDay: Date, endDay: Date) => void;
  setStartTime: (time: string) => void;
  setEndTime: (time: string) => void;
  clear: () => void;
  /** The draft as instants, or null while a date is missing. */
  period: RentalPeriodValue | null;
  validation: RentalPeriodValidation;
  canSubmit: boolean;
  buildFinalRange: () => RentalPeriodValue | null;
}

export interface TimeRangeBuildOptions {
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  timezone?: string;
}
