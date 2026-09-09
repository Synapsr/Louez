"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Seconds left of a cooldown that starts on mount and can be restarted
 * (resend buttons). The interval is the only effect; the remaining seconds
 * are state, not derived.
 */
export const useResendCooldown = (seconds: number) => {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [secondsLeft, setSecondsLeft] = useState(seconds);

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  const restart = useCallback(() => setEndsAt(Date.now() + seconds * 1000), [seconds]);

  return { secondsLeft, restart };
};
