import { parseCalendarDateParam, toCalendarDateParam } from "./calendar-query";

const STORAGE_PREFIX = "louez:timeline-anchor:";

export interface TimelineAnchorData {
  date: Date;
  scrollLeft?: number;
}

export function saveTimelineAnchor(storeId: string, date: Date, scrollLeft?: number): void {
  if (typeof window === "undefined" || !storeId) return;
  try {
    const payload = {
      date: toCalendarDateParam(date),
      scrollLeft: typeof scrollLeft === "number" && !Number.isNaN(scrollLeft) ? Math.round(scrollLeft) : undefined,
      timestamp: Date.now(),
    };
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${storeId}`, JSON.stringify(payload));
  } catch {
    // sessionStorage not available or quota exceeded
  }
}

export function getTimelineAnchor(storeId: string): TimelineAnchorData | null {
  if (typeof window === "undefined" || !storeId) return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${storeId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.date || typeof data.date !== "string") return null;

    const parsedDate = parseCalendarDateParam(data.date);
    if (!parsedDate) return null;

    return {
      date: parsedDate,
      scrollLeft: typeof data.scrollLeft === "number" ? data.scrollLeft : undefined,
    };
  } catch {
    return null;
  }
}

export function clearTimelineAnchor(storeId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (storeId) {
      window.sessionStorage.removeItem(`${STORAGE_PREFIX}${storeId}`);
    } else {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore
  }
}
