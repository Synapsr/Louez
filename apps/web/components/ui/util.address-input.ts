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

/**
 * Asks once, with an abort of its own (`request`): the answer, or a rejection
 * once the bound passes, which aborts the request, or once the caller aborts
 * it (a newer ask replaced it, its field went). Either way the request's
 * network call is aborted and its timer cleared. Nothing is shared with
 * anyone else's request of the same text or place.
 */
export const askWithinBound = <T>(
  ask: (signal: AbortSignal) => T | Promise<T>,
  request: AbortController = new AbortController(),
  bound: number = ADDRESS_REQUEST_BOUND_MS,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const { signal } = request;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => request.abort(new AddressRequestTimeout()), bound);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    new Promise<T>((answer) => answer(ask(signal))).then(
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
