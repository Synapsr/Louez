"use client";

import type { OpenReplayEventName, OpenReplayEventPayload } from "./events";

type QueuedOpenReplayEvent = {
  name: OpenReplayEventName;
  payload: OpenReplayEventPayload<OpenReplayEventName>;
};

type OpenReplayEventEmitter = (event: QueuedOpenReplayEvent) => void;

declare global {
  interface Window {
    __louezOpenReplayEventEmitter?: OpenReplayEventEmitter;
    __louezOpenReplayEventQueue?: QueuedOpenReplayEvent[];
  }
}

export const trackOpenReplayEvent = <Name extends OpenReplayEventName>(
  name: Name,
  payload: OpenReplayEventPayload<Name>,
) => {
  const event = { name, payload };

  if (window.__louezOpenReplayEventEmitter) {
    window.__louezOpenReplayEventEmitter(event);
    return;
  }

  window.__louezOpenReplayEventQueue ??= [];
  window.__louezOpenReplayEventQueue.push(event);
};

export const markOpenReplayReady = (emit: OpenReplayEventEmitter) => {
  window.__louezOpenReplayEventEmitter = emit;

  const queuedEvents = window.__louezOpenReplayEventQueue ?? [];
  window.__louezOpenReplayEventQueue = [];

  queuedEvents.forEach(emit);
};
