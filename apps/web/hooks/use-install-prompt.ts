'use client';

import * as React from 'react';

import { detectPlatform, type PlatformInfo } from '@/lib/pwa/detect';

/**
 * Chromium fires `beforeinstallprompt` once, early in the page lifecycle —
 * potentially before any React component has mounted. We therefore capture and
 * stash the event at module scope (the listeners are attached as soon as this
 * client chunk is evaluated, during hydration) so no install opportunity is
 * lost, and let components subscribe to changes.
 *
 * `BeforeInstallPromptEvent` and the `beforeinstallprompt` event are typed in
 * apps/web/types/pwa.d.ts.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chromium's default mini-infobar so we can present our own UI.
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    deferredPrompt = null;
    notify();
  });
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

const DISMISS_KEY = 'louez:pwa-install-dismissed-at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  const iosStandalone = window.navigator.standalone;
  return Boolean(mql?.matches) || iosStandalone === true;
}

function wasRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Drives the adaptive install prompt:
 *  - `android` / `desktop` — Chromium captured a `beforeinstallprompt`; a real
 *    install button is available.
 *  - `ios-safari` — manual "Add to Home Screen" instructions (iOS has no
 *    programmatic prompt and only Safari can install).
 *  - `ios-other` — iOS Chrome/Firefox/Edge cannot install: tell the user to
 *    open the page in Safari.
 *  - `in-app` — embedded webview where install is impossible.
 *  - `hidden` — already installed, ineligible, recently dismissed, or not yet
 *    resolved (server / first paint).
 */
export type InstallStatus =
  | 'hidden'
  | 'android'
  | 'desktop'
  | 'ios-safari'
  | 'ios-other'
  | 'in-app';

export interface UseInstallPrompt {
  status: InstallStatus;
  platform: PlatformInfo | null;
  /** Triggers the native install dialog (Chromium only). Returns the outcome. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | null>;
  /** Snoozes the prompt for ~30 days. */
  dismiss: () => void;
}

export function useInstallPrompt(): UseInstallPrompt {
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  const [platform, setPlatform] = React.useState<PlatformInfo | null>(null);
  const [standalone, setStandalone] = React.useState<boolean | null>(null);
  const [dismissed, setDismissed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(isStandaloneDisplay());
    setDismissed(wasRecentlyDismissed());

    const unsubscribe = subscribe(forceUpdate);
    const mql = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setStandalone(isStandaloneDisplay());
    mql.addEventListener?.('change', onDisplayChange);

    return () => {
      unsubscribe();
      mql.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const dismiss = React.useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore (private mode / storage disabled): we simply re-show next time.
    }
    setDismissed(true);
  }, []);

  const promptInstall = React.useCallback(async () => {
    const promptEvent = deferredPrompt;
    if (!promptEvent) return null;
    // Consume the event synchronously: prompt() can only be used once per
    // event, so a fast double-click must not reach a second prompt() call.
    deferredPrompt = null;
    notify();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      // If the user declined the native dialog, snooze our prompt too.
      if (choice.outcome === 'dismissed') dismiss();
      return choice.outcome;
    } catch {
      return null;
    }
  }, [dismiss]);

  // Not memoized: it depends on module-level state (deferredPrompt/appInstalled)
  // that `forceUpdate` re-reads on every relevant change.
  let status: InstallStatus = 'hidden';
  if (platform !== null && standalone !== null && dismissed !== null) {
    if (appInstalled || standalone || dismissed) {
      status = 'hidden';
    } else if (platform.isInAppBrowser) {
      status = 'in-app';
    } else if (platform.os === 'ios') {
      status = platform.browser === 'safari' ? 'ios-safari' : 'ios-other';
    } else if (deferredPrompt) {
      status = platform.os === 'android' ? 'android' : 'desktop';
    }
  }

  return { status, platform, promptInstall, dismiss };
}
