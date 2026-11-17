import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";

// For the tests of the hand-off routes (app/handoffs): what a browser sends
// when a person clicks a form of a hand-off page, and the stubs the routes
// load in place of Better Auth, the app's ports and the request's locale.

/**
 * The headers a browser sends with a form posted from a hand-off page. The
 * pages send no referrer, so the browser hides their origin (`Origin: null`)
 * and says where the post comes from in `Sec-Fetch-Site`, which no page can
 * set (Fetch, "serializing a request origin").
 */
export const BROWSER_POST = { origin: "null", "sec-fetch-site": "same-origin" } as const;

/** The test header the stubbed session is read from. */
export const SESSION_HEADER = "x-test-session-user";

/**
 * Makes the hand-off routes load stubs: `@louez/auth` reads the session from
 * `SESSION_HEADER`, `@/lib/auth`'s `auth()` answers the user `signIn` set,
 * `@/lib/api/ports` is `ports`, and the request's locale is English. Call it
 * before any route module is imported.
 */
export function stubHandoffRoutes(ports: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "louez-handoff-routes-"));
  after(() => rmSync(directory, { recursive: true }));
  const state: { userId: string | null } = { userId: null };
  Reflect.set(globalThis, "__louezHandoffRoutes", { ports, state });

  const stubs: Record<string, string> = {
    "@louez/auth": `export const auth = {};
export const mcpOAuth = null;
export const authInstance = {
  api: {
    getSession: async ({ headers }) => {
      const id = headers.get(${JSON.stringify(SESSION_HEADER)});
      return id ? { user: { id, email: id + "@handoffs.test" } } : null;
    },
  },
};`,
    "@/lib/auth": `const { state } = globalThis.__louezHandoffRoutes;
export const auth = async () =>
  state.userId ? { user: { id: state.userId, email: state.userId + "@handoffs.test" } } : null;`,
    "@/lib/api/ports": "export const apiPorts = globalThis.__louezHandoffRoutes.ports;",
    "next-intl/server": `export const getLocale = async () => "en";`,
  };
  const urls = new Map(
    Object.entries(stubs).map(([specifier, source], index) => {
      const path = join(directory, `stub-${index}.mjs`);
      writeFileSync(path, source);
      return [specifier, pathToFileURL(path).href];
    }),
  );
  Reflect.get(
    nodeModule,
    "registerHooks",
  )({
    resolve(
      specifier: string,
      context: unknown,
      next: (specifier: string, context: unknown) => unknown,
    ) {
      if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
      const url = urls.get(specifier);
      return url ? { url, shortCircuit: true } : next(specifier, context);
    },
  });

  return {
    /** The user `auth()` answers for, or null signed out. */
    signIn: (userId: string | null) => {
      state.userId = userId;
    },
  };
}
