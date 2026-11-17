import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * How long the field waits for the address service. A search or a pick that
 * has not answered by then is given up, so the spinner never stays on and the
 * field's own controls come back; an answer arriving later is ignored.
 */
export const ADDRESS_REQUEST_BOUND_MS = 10_000;

export class AddressRequestTimeout extends Error {
  constructor() {
    super("The address service did not answer in time");
    this.name = "AddressRequestTimeout";
  }
}

/** Whether a request ended because it was given up: at the bound, or with its field. */
export const isGivenUp = (error: unknown) =>
  error instanceof AddressRequestTimeout || (error instanceof Error && error.name === "AbortError");

/**
 * The answer, or a rejection once the bound has passed without one, or once
 * `signal` aborts (the field is gone). Either way its timer is cleared.
 */
export const withinRequestBound = <T>(
  answer: T | Promise<T>,
  { signal, bound = ADDRESS_REQUEST_BOUND_MS }: { signal?: AbortSignal; bound?: number } = {},
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      settle();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      settle();
      reject(new AddressRequestTimeout());
    }, bound);
    signal?.addEventListener("abort", onAbort);
    Promise.resolve(answer).then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
  });

/** How many asks of each query are still waiting for its answer, per query client. */
const waiting = new WeakMap<QueryClient, Map<string, number>>();

/**
 * Fetches `queryKey` through the query client (`fetch` asks it) within the
 * bound. A query client shares one request between every ask of the same
 * query, so an ask given up does not end the request by itself: once no ask
 * waits for it any more, it is cancelled (its fetch aborted), and the next
 * ask of the same text or place starts a new one. A request another field,
 * or a newer ask, still waits for goes on.
 */
export const fetchWithinBound = async <T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  fetch: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const key = hashKey(queryKey);
  let counts = waiting.get(queryClient);
  if (!counts) {
    counts = new Map();
    waiting.set(queryClient, counts);
  }
  const waiters = counts;
  waiters.set(key, (waiters.get(key) ?? 0) + 1);
  let isWaiting = true;
  /** This ask stops waiting; true when no other ask waits for the request. */
  const stopWaiting = () => {
    if (!isWaiting) return false;
    isWaiting = false;
    const left = (waiters.get(key) ?? 1) - 1;
    if (left > 0) waiters.set(key, left);
    else waiters.delete(key);
    return left === 0;
  };
  try {
    return await withinRequestBound(fetch(), { signal });
  } catch (error) {
    if (isGivenUp(error) && stopWaiting()) {
      void queryClient.cancelQueries({ queryKey, exact: true });
    }
    throw error;
  } finally {
    stopWaiting();
  }
};
