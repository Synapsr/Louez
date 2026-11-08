import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The abort of the outbox sender running now (packages/api
 * platform/effects.ts), carried to the provider calls under it: the SMS
 * API, the Discord webhooks, fromHello, PostHog, the store logo, SMTP, web
 * push. A sender runs its work in `withEffectSignal`; a fetch passes
 * `providerSignal()`, and a provider that cannot be aborted calls
 * `throwIfEffectAborted()` right before it starts.
 * Outside a sender there is no signal, and callers behave as before.
 */
interface EffectRun {
  signal: AbortSignal;
  /** Throws once the sender is out of time, even before its timer fired. */
  throwIfAborted?: () => void;
}

const current = new AsyncLocalStorage<EffectRun>();

/** Each provider call's own limit, well below the sender's timeout. */
export const PROVIDER_TIMEOUT_MS = 30_000;

export function withEffectSignal<T>(run: EffectRun, work: () => Promise<T>): Promise<T> {
  return current.run(run, work);
}

/** Throws when the running sender is out of time. */
function check(run: EffectRun) {
  if (run.throwIfAborted) run.throwIfAborted();
  else run.signal.throwIfAborted();
}

/**
 * The signal a fetch honours inside a sender: the sender's, and its own
 * timeout. Already aborted when the sender is out of time, so the fetch
 * does not start.
 */
export function providerSignal(): AbortSignal | undefined {
  const run = current.getStore();
  if (!run) return undefined;
  try {
    check(run);
  } catch {
    // The check aborts the sender's signal; the fetch then rejects at once.
  }
  return AbortSignal.any([run.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);
}

/**
 * Throws when the running sender is out of time (its lease may pass to a
 * retry). A provider call that cannot be aborted, such as SMTP or web push,
 * calls it last, right before it starts.
 */
export function throwIfEffectAborted(): void {
  const run = current.getStore();
  if (run) check(run);
}

/** Whether a sender is running: a provider without abort then uses its own timeout. */
export function inEffectSender(): boolean {
  return current.getStore() !== undefined;
}
