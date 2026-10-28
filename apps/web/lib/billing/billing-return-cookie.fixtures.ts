import type { BillingReturnCookieJar, BillingReturnCookieOptions } from "./billing-return-cookie";

// A cookie jar as `cookies()` gives a route handler, for the tests of the hand-off and
// its return: the request's cookies, and what the response writes.

export type CookieWrite =
  | {
      readonly op: "set";
      readonly name: string;
      readonly value: string;
      readonly options: BillingReturnCookieOptions;
    }
  | { readonly op: "delete"; readonly name: string; readonly path: string };

export function fakeCookieJar(requestCookies: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(requestCookies));
  const reads: string[] = [];
  const writes: CookieWrite[] = [];
  const jar: BillingReturnCookieJar = {
    get(name) {
      reads.push(name);
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name, value, options) {
      writes.push({ op: "set", name, value, options });
      values.set(name, value);
    },
    delete({ name, path }) {
      writes.push({ op: "delete", name, path });
      values.delete(name);
    },
  };
  return { jar, reads, writes };
}
