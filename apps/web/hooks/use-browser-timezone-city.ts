"use client";

import { useEffect, useState } from "react";

export function useBrowserTimezoneCity(timezone?: string): string | null {
  const [timezoneCity, setTimezoneCity] = useState<string | null>(null);

  useEffect(() => {
    if (!timezone) {
      setTimezoneCity(null);
      return;
    }

    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (browserTimezone === timezone) {
      setTimezoneCity(null);
      return;
    }

    setTimezoneCity(timezone.split("/").pop()?.replace(/_/g, " ") || timezone);
  }, [timezone]);

  return timezoneCity;
}
