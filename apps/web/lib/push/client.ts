/**
 * Web Push sender (server-only). Wraps the Node-only `web-push` library so it
 * never leaks into a client bundle. Uses the app-wide VAPID keypair from env.
 */
import 'server-only';

import webpush from 'web-push';

import { env } from '@/env';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Origin-relative URL opened on notification click. */
  url?: string;
  /** Coalesces notifications that share a tag. */
  tag?: string;
}

export interface SendPushResult {
  success: boolean;
  /** HTTP status from the push service (404/410 = gone → prune the row). */
  statusCode?: number;
  error?: string;
}

/** True when the VAPID keypair is configured (push is otherwise unavailable). */
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!env.VAPID_PRIVATE_KEY || !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT || env.NEXT_PUBLIC_APP_URL,
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    vapidReady = true;
  }
  return true;
}

export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    return { success: false, error: 'VAPID keys not configured' };
  }
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 }, // keep ~12h if the device is offline
    );
    return { success: true };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    return {
      success: false,
      statusCode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
