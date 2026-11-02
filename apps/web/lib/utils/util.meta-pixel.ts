/**
 * Tells Meta that this browser belongs to a store that finished onboarding, so
 * ad sets can exclude it. It sends this one custom event and nothing else: no
 * PageView and no automatic event collection.
 */

const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

// The event name the signed-up audience in fromHello fires and Meta filters on.
const SIGNED_UP_EVENT = "fh_signed_up";

const LAST_FIRED_KEY = "louez_meta_signed_up_at";

// Well inside Meta's 180-day audience limit, so a store that keeps using the
// dashboard stays excluded.
const REFIRE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  loaded: boolean;
  push?: Fbq;
  queue: unknown[][];
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export const isMetaSignedUpEventDue = (lastFiredAt: string | null, now: number): boolean => {
  const last = Number(lastFiredAt);

  return !Number.isFinite(last) || now - last >= REFIRE_AFTER_MS;
};

const readLastFiredAt = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_FIRED_KEY);
  } catch {
    return null;
  }
};

const writeLastFiredAt = (now: number): void => {
  try {
    window.localStorage.setItem(LAST_FIRED_KEY, String(now));
  } catch {
    // Without storage the event is sent again on the next visit, which is harmless.
  }
};

// Meta's standard stub: queues calls until fbevents.js loads and replays them.
const createFbqStub = (): Fbq => {
  const queue: unknown[][] = [];
  const fbq: Fbq = Object.assign(
    (...args: unknown[]) => {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, args);
      } else {
        queue.push(args);
      }
    },
    { loaded: true, queue, version: "2.0" },
  );
  fbq.push = fbq;

  return fbq;
};

export const fireMetaSignedUpEvent = (pixelId: string): void => {
  if (window.fbq || !isMetaSignedUpEventDue(readLastFiredAt(), Date.now())) {
    return;
  }

  const fbq = createFbqStub();
  window.fbq = fbq;
  window._fbq = fbq;

  fbq("set", "autoConfig", false, pixelId);
  fbq("init", pixelId);
  fbq("trackSingleCustom", pixelId, SIGNED_UP_EVENT);

  const script = document.createElement("script");
  script.async = true;
  script.src = SCRIPT_SRC;
  // Stays due if a blocker stops the script, so the next visit tries again.
  script.onload = () => writeLastFiredAt(Date.now());
  document.head.appendChild(script);
};
