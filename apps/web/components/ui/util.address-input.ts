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

/** The answer, or a rejection once the bound has passed without one. */
export const withinRequestBound = <T>(
  answer: T | Promise<T>,
  bound = ADDRESS_REQUEST_BOUND_MS,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AddressRequestTimeout()), bound);
    Promise.resolve(answer).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
