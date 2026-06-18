'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tiny external store that tracks whether a bottom-anchored save bar is on
 * screen. The FloatingSaveBar publishes its visibility here so other
 * bottom-fixed UI (notably the PWA install banner) can yield the slot and never
 * cover the Save/Cancel actions.
 */
let visible = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setSaveBarVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSaveBarVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => visible,
    () => false,
  );
}
