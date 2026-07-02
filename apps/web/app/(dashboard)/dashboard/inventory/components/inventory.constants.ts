import type { InventoryOperationalState } from '../queries';

export const INVENTORY_STATE_OPTIONS = [
  'available',
  'reserved',
  'rented_out',
  'overdue',
  'in_downtime',
  'retired',
] satisfies InventoryOperationalState[];

export const DOWNTIME_REASON_OPTIONS = [
  'maintenance',
  'repair',
  'other',
] satisfies DowntimeReasonOption[];

export const RETIREMENT_REASON_OPTIONS = [
  'sold',
  'lost',
  'broken',
  'other',
] satisfies RetirementReasonOption[];

export type DowntimeReasonOption = 'maintenance' | 'repair' | 'other';
export type RetirementReasonOption = 'sold' | 'lost' | 'broken' | 'other';

export const isInventoryStateOption = (
  value: string,
): value is InventoryOperationalState =>
  INVENTORY_STATE_OPTIONS.some((option) => option === value);

export const isDowntimeReasonOption = (
  value: string,
): value is DowntimeReasonOption =>
  DOWNTIME_REASON_OPTIONS.some((option) => option === value);

export const isRetirementReasonOption = (
  value: string,
): value is RetirementReasonOption =>
  RETIREMENT_REASON_OPTIONS.some((option) => option === value);
