import type { GuardedFetch } from "@louez/auth/guarded-fetch";
import * as guardedFetch from "@louez/auth/guarded-fetch";

/**
 * A fake transport for image imports by URL, for tests: nothing leaves the
 * process. A suite mocks `@louez/auth/guarded-fetch` with `namedExports`,
 * before the upload service loads: the real guarded GET (redirects, caps,
 * timeouts) runs over this transport. As the real one (CIMD) does, it throws
 * for a host that resolves to a private address: here, any host named
 * `internal` or an IP literal.
 */
export function createTestImageFetch(): {
  asked: string[];
  serve: (next: Record<string, () => Response | Promise<Response>>) => void;
  /** The module's exports, its guarded GET bound to this transport. */
  namedExports: Record<string, unknown>;
} {
  let routes: Record<string, () => Response | Promise<Response>> = {};
  const asked: string[] = [];

  const transport: GuardedFetch = async (input) => {
    const url = String(input);
    asked.push(url);
    const { hostname } = new URL(url);
    if (hostname.includes("internal") || /^[\d.]+$|^\[/.test(hostname)) {
      throw new TypeError("metadata hostname must resolve only to public-routable addresses");
    }
    return routes[url]?.() ?? new Response(null, { status: 404 });
  };

  return {
    asked,
    /** What each URL answers; any other URL answers 404. */
    serve(next: Record<string, () => Response | Promise<Response>>) {
      routes = next;
      asked.length = 0;
    },
    namedExports: {
      ...guardedFetch,
      guardedGet: (url: string, options: guardedFetch.GuardedGetOptions) =>
        guardedFetch.guardedGet(url, { ...options, fetchResource: transport }),
    },
  };
}
