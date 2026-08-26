"use client";

import * as React from "react";

import { useMutation } from "@tanstack/react-query";
import { log } from "evlog/next/client";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { detectPlatform, type PlatformInfo } from "@/lib/pwa/detect";
import { orpc } from "@/lib/orpc/react";

/**
 *  - loading           — resolving capabilities (server / first paint)
 *  - unsupported       — no Push API (and not the iOS-needs-install case)
 *  - ios-needs-install — iOS browser, push only works once installed (16.4+)
 *  - denied            — the user blocked notifications
 *  - subscribed        — enabled on this device
 *  - prompt            — supported and can be enabled
 */
export type PushState =
  | "loading"
  | "unsupported"
  | "ios-needs-install"
  | "denied"
  | "subscribed"
  | "prompt";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
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
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublicKey } = usePublicEnv();
  const subscribeMutation = useMutation(orpc.dashboard.notifications.subscribe.mutationOptions());
  const unsubscribeMutation = useMutation(
    orpc.dashboard.notifications.unsubscribe.mutationOptions(),
  );

  const [platform, setPlatform] = React.useState<PlatformInfo | null>(null);
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [standalone, setStandalone] = React.useState<boolean | null>(null);
  const [permission, setPermission] = React.useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setPlatform(detectPlatform());
    const isSupported = pushSupported() && Boolean(vapidPublicKey);
    setSupported(isSupported);
    setStandalone(isStandalone());
    setPermission(isSupported ? Notification.permission : "default");

    if (isSupported) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setSubscribed(Boolean(sub)))
        .catch(() => setSubscribed(false));
    } else {
      setSubscribed(false);
    }
  }, [vapidPublicKey]);

  const enable = React.useCallback(async (): Promise<boolean> => {
    if (!vapidPublicKey) return false;
    let stage = "permission";

    try {
      // Once permission is granted, requesting it again can leave some
      // browsers waiting on a prompt that will never be shown. Reuse the
      // current grant and continue directly with the device subscription.
      const result =
        Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return false;

      stage = "browser_subscription";
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        log.warn({ action: "push_subscription_invalid", stage });
        return false;
      }

      stage = "server_registration";
      await subscribeMutation.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent.slice(0, 512),
      });
      setSubscribed(true);
      return true;
    } catch (error) {
      log.warn({
        action: "push_subscription_enable_failed",
        stage,
        error: error instanceof Error ? error.message : String(error),
      });
      setPermission(Notification.permission);
      setSubscribed(false);
      return false;
    }
  }, [subscribeMutation, vapidPublicKey]);

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

  let state: PushState = "loading";
  if (
    supported !== null &&
    standalone !== null &&
    permission !== null &&
    subscribed !== null &&
    platform !== null
  ) {
    if (platform.os === "ios" && !standalone) state = "ios-needs-install";
    else if (!supported) state = "unsupported";
    else if (permission === "denied") state = "denied";
    else if (subscribed) state = "subscribed";
    else state = "prompt";
  }

  return {
    state,
    platform,
    busy: subscribeMutation.isPending || unsubscribeMutation.isPending,
    enable,
    disable,
  };
}
