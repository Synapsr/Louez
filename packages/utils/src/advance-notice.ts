/**
 * Get the exact minimum start date/time based on advance notice
 * This returns the precise moment when a reservation can start.
 */
export function getMinStartDateTime(
  advanceNoticeMinutes: number = 0,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + advanceNoticeMinutes * 60 * 1000);
}

export type AdvanceNoticeValidation = { valid: true } | { valid: false; minimumStartTime: Date };

/**
 * Validate the exact start instant against the configured advance notice.
 * The optional clock makes the boundary deterministic in tests.
 */
export function validateAdvanceNotice(
  startDate: Date,
  advanceNoticeMinutes: number = 0,
  now: Date = new Date(),
): AdvanceNoticeValidation {
  if (advanceNoticeMinutes <= 0) return { valid: true };

  const minimumStartTime = getMinStartDateTime(advanceNoticeMinutes, now);

  return startDate < minimumStartTime ? { valid: false, minimumStartTime } : { valid: true };
}
