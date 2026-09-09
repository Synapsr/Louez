"use client";

import { useCallback, useMemo, useState } from "react";

import { useFormatLocale } from "@/hooks/use-format-locale";

import { getMinStartDateTime, validateAdvanceNotice } from "@/lib/utils/duration";
import { formatDurationFromMinutes } from "@/lib/utils/rental-duration";

interface UseCheckoutAdvanceNoticeParams {
  startDate: string | null;
  advanceNoticeMinutes: number;
  timezone?: string;
}

interface ServerAdvanceNoticeIssue {
  failedStartDate: string | null;
  advanceNoticeMinutes: number;
  minimumStartTime: string;
}

export interface AdvanceNoticeIssueDisplay {
  duration: string;
  minimumStart: string;
  advanceNoticeMinutes: number;
}

/**
 * Advance-notice check, evaluated as soon as the checkout mounts (a customer
 * who lingered in the cart sees the alert before filling anything). A server
 * rejection with a stricter rule overrides the client one until the dates
 * change.
 */
export const useCheckoutAdvanceNotice = ({
  startDate,
  advanceNoticeMinutes,
  timezone,
}: UseCheckoutAdvanceNoticeParams) => {
  const { intl: formatLocale } = useFormatLocale();
  const [serverIssue, setServerIssue] = useState<ServerAdvanceNoticeIssue | null>(null);

  const issue = useMemo<AdvanceNoticeIssueDisplay | null>(() => {
    const format = (iso: string, minutes: number): AdvanceNoticeIssueDisplay => ({
      duration: formatDurationFromMinutes(minutes),
      advanceNoticeMinutes: minutes,
      minimumStart: new Intl.DateTimeFormat(formatLocale, {
        dateStyle: "long",
        timeStyle: "short",
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(new Date(iso)),
    });

    if (serverIssue && serverIssue.failedStartDate === startDate) {
      return format(serverIssue.minimumStartTime, serverIssue.advanceNoticeMinutes);
    }

    if (!startDate) return null;

    const validation = validateAdvanceNotice(new Date(startDate), advanceNoticeMinutes);
    if (validation.valid) return null;

    return format(validation.minimumStartTime.toISOString(), advanceNoticeMinutes);
  }, [advanceNoticeMinutes, formatLocale, serverIssue, startDate, timezone]);

  const reportServerIssue = useCallback(
    (params: { advanceNoticeMinutes?: number; minimumStartTime?: string }) => {
      const minutes = params.advanceNoticeMinutes ?? advanceNoticeMinutes;
      setServerIssue({
        failedStartDate: startDate,
        advanceNoticeMinutes: minutes,
        minimumStartTime: params.minimumStartTime ?? getMinStartDateTime(minutes).toISOString(),
      });
    },
    [advanceNoticeMinutes, startDate],
  );

  return { issue, reportServerIssue };
};
