import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The abort signal of the outbox sender running now (packages/api
 * platform/effects.ts), carried to the provider calls under it: the SMS
 * API, the Discord webhooks, fromHello, PostHog. A sender runs its work in
 * `withEffectSignal`; a provider call passes `providerSignal()` to fetch.
 * Outside a sender there is no signal, and callers behave as before.
 */
const current = new AsyncLocalStorage<AbortSignal>();

/** Each provider call's own limit, well below the sender's timeout. */
export const PROVIDER_TIMEOUT_MS = 30_000;

export function withEffectSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return current.run(signal, run);
}

/** The signal a provider call honours inside a sender: the sender's, and its own timeout. */
export function providerSignal(): AbortSignal | undefined {
  const signal = current.getStore();
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]) : undefined;
}

/**
 * Throws when the running sender was aborted (timed out, so its lease may
 * pass to a retry). A provider call that cannot be aborted, such as SMTP,
 * calls it last, after any preparation that may have stalled.
 */
export function throwIfEffectAborted(): void {
  current.getStore()?.throwIfAborted();
}

/** Whether a sender is running: a provider without abort then uses its own timeout. */
export function inEffectSender(): boolean {
  return current.getStore() !== undefined;
}
