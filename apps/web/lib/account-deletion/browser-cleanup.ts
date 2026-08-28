"use client";

import Gleap from "gleap";
import posthog from "posthog-js";

const stopOpenReplay = () => {
  const tracker = Reflect.get(window, "__louezOpenReplayTracker");
  if (typeof tracker === "object" && tracker !== null) {
    const stop = Reflect.get(tracker, "stop");
    if (typeof stop === "function") {
      Reflect.apply(stop, tracker, []);
    }
  }

  for (const key of [
    "__louezOpenReplayTracker",
    "__louezOpenReplayTrackerPromise",
    "__louezOpenReplayProjectKey",
    "__louezOpenReplayStartPromise",
    "__louezOpenReplayEventEmitter",
    "__louezOpenReplayEventQueue",
  ]) {
    Reflect.deleteProperty(window, key);
  }
};

export const clearAccountDeletionBrowserState = () => {
  posthog.reset();

  try {
    Gleap.clearIdentity();
    Gleap.destroy();
  } catch {
    // An uninitialized support widget has no browser identity to clear.
  }

  try {
    stopOpenReplay();
  } catch {
    // An uninitialized replay tracker has no browser identity to clear.
  }
};
