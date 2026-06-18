'use client';

import * as React from 'react';

import { useMutation } from '@tanstack/react-query';

import { detectPlatform, type PlatformInfo } from '@/lib/pwa/detect';
import { orpc } from '@/lib/orpc/react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 *  - loading           — resolving capabilities (server / first paint)
 *  - unsupported       — no Push API (and not the iOS-needs-install case)
 *  - ios-needs-install — iOS browser, push only works once installed (16.4+)
 *  - denied            — the user blocked notifications
 *  - subscribed        — enabled on this device
 *  - prompt            — supported and can be enabled
 */
export type PushState =
  | 'loading'
  | 'unsupported'
  | 'ios-needs-install'
  | 'denied'
  | 'subscribed'
  | 'prompt';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export interface UsePushSubscription {
  state: PushState;
  platform: PlatformInfo | null;
  busy: boolean;
  /** Requests permission (from a user gesture) and registers the device. */
  enable: () => Promise<boolean>;
  /** Removes this device's subscription. */
  disable: () => Promise<void>;
}

export function usePushSubscription(): UsePushSubscription {
  const subscribeMutation = useMutation(
    orpc.dashboard.notifications.subscribe.mutationOptions(),
  );
  const unsubscribeMutation = useMutation(
    orpc.dashboard.notifications.unsubscribe.mutationOptions(),
  );

  const [platform, setPlatform] = React.useState<PlatformInfo | null>(null);
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [standalone, setStandalone] = React.useState<boolean | null>(null);
  const [permission, setPermission] =
    React.useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setPlatform(detectPlatform());
    const isSupported = pushSupported() && Boolean(VAPID_PUBLIC_KEY);
    setSupported(isSupported);
    setStandalone(isStandalone());
    setPermission(isSupported ? Notification.permission : 'default');

    if (isSupported) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setSubscribed(Boolean(sub)))
        .catch(() => setSubscribed(false));
    } else {
      setSubscribed(false);
    }
  }, []);

  const enable = React.useCallback(async (): Promise<boolean> => {
    if (!VAPID_PUBLIC_KEY) return false;
    try {
      // requestPermission must be the first call so the user gesture carries
      // through (required on iOS).
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return false;
      }

      await subscribeMutation.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent.slice(0, 512),
      });
      setSubscribed(true);
      return true;
    } catch {
      // Subscribe / network failure — surface nothing here; the caller keeps the
      // enable affordance so the merchant can retry. No unhandled rejection.
      return false;
    }
  }, [subscribeMutation]);

  const disable = React.useCallback(async (): Promise<void> => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await unsubscribeMutation.mutateAsync({ endpoint }).catch(() => {});
    }
    setSubscribed(false);
  }, [unsubscribeMutation]);

  let state: PushState = 'loading';
  if (
    supported !== null &&
    standalone !== null &&
    permission !== null &&
    subscribed !== null &&
    platform !== null
  ) {
    if (platform.os === 'ios' && !standalone) state = 'ios-needs-install';
    else if (!supported) state = 'unsupported';
    else if (permission === 'denied') state = 'denied';
    else if (subscribed) state = 'subscribed';
    else state = 'prompt';
  }

  return {
    state,
    platform,
    busy: subscribeMutation.isPending || unsubscribeMutation.isPending,
    enable,
    disable,
  };
}
