import type { BusinessHours } from '@louez/types';

export interface RentalDateCoreOptions {
  startDate?: Date;
  endDate?: Date;
  startTime: string;
  endTime: string;
  businessHours?: BusinessHours;
  advanceNotice?: number;
  timezone?: string;
  intervalMinutes?: number;
}

export interface RentalDateCoreState {
  defaultTimeSlots: string[];
  minDate: Date;
  isSameDay: boolean;
  startTimeSlots: string[];
  endTimeSlots: string[];
  isDateDisabled: (date: Date) => boolean;
}

export interface TimeRangeBuildOptions {
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  timezone?: string;
}
