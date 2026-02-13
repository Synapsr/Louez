'use client';

import { useCallback, useState } from 'react';

const DAY_MINUTES = 1440;
const HOUR_MINUTES = 60;

export type DurationUnit = 'hours' | 'days';

interface UseStoreSettingsUnitsParams {
  minRentalMinutes: number;
  advanceNoticeMinutes: number;
}

function getInitialUnit(valueInMinutes: number): DurationUnit {
  return valueInMinutes > 0 && valueInMinutes % DAY_MINUTES === 0
    ? 'days'
    : 'hours';
}

export function useStoreSettingsUnits({
  minRentalMinutes,
  advanceNoticeMinutes,
}: UseStoreSettingsUnitsParams) {
  const [minDurationUnit, setMinDurationUnit] = useState<DurationUnit>(
    getInitialUnit(minRentalMinutes),
  );
  const [advanceNoticeUnit, setAdvanceNoticeUnit] = useState<DurationUnit>(
    getInitialUnit(advanceNoticeMinutes),
  );

  const getDisplayValue = useCallback(
    (valueInMinutes: number, unit: DurationUnit) =>
      unit === 'days'
        ? Math.round(valueInMinutes / DAY_MINUTES)
        : Math.round(valueInMinutes / HOUR_MINUTES),
    [],
  );

  const fromDisplayValue = useCallback(
    (rawValue: number, unit: DurationUnit) =>
      unit === 'days' ? rawValue * DAY_MINUTES : rawValue * HOUR_MINUTES,
    [],
  );

  const normalizeForUnitSwitch = useCallback(
    (valueInMinutes: number, nextUnit: DurationUnit) => {
      if (nextUnit === 'days') {
        const days = Math.round(valueInMinutes / DAY_MINUTES);
        return days * DAY_MINUTES;
      }
      return valueInMinutes;
    },
    [],
  );

  return {
    minDurationUnit,
    setMinDurationUnit,
    advanceNoticeUnit,
    setAdvanceNoticeUnit,
    getDisplayValue,
    fromDisplayValue,
    normalizeForUnitSwitch,
  };
}

export type StoreSettingsUnitsState = ReturnType<typeof useStoreSettingsUnits>;
