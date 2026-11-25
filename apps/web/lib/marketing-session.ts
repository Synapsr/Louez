import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@louez/db";
import { excludeDemoStores } from "@louez/db/demo-stores";
import { stores } from "@louez/db/schema";

import { readCookie } from "@/lib/acquisition/first-touch";
import { ACTIVE_STORE_COOKIE } from "@/lib/active-store-cookie";
import { isDemoOwnerEmail } from "@/lib/demo/constants";

const originSchema = z
  .url({ protocol: /^https?$/ })
  .pipe(z.string().refine((value) => new URL(value).origin === value));

// A store id as `stores.id` holds it: a nanoid of at most 21 characters.
const storeIdSchema = z.string().regex(/^[\w-]{1,21}$/);

/** What the marketing website may learn of a browser: two booleans, never who it is. */
export interface MarketingSession {
  authenticated: boolean;
  hasAccount: boolean;
}

export function marketingOrigins(appUrl: string, extraOrigins: string[] = []): string[] {
  const host = new URL(appUrl).hostname;
  const defaults =
    host === "app.louez.io"
      ? ["https://louez.io", "https://www.louez.io"]
      : host === "app.louez.app"
        ? ["https://louez.app", "https://www.louez.app"]
        : [];
  return [...defaults, ...extraOrigins];
}

/**
 * `hasAccount`: whether this browser belongs to someone with a Louez account, from
 * what the app already keeps (docs/analytics/README.md). A signed-in session counts,
 * unless it is a demo visitor's throwaway account. Signed out, the dashboard's active
 * store cookie counts when it names a real store: signing out leaves it, and
 * `/api/demo/start` points it at the visitor's demo store, which does not count.
 */
export async function readMarketingSession(
  executor: Pick<Database, "select">,
  session: { user: { email: string } } | null,
  cookieHeader: string | null,
): Promise<MarketingSession> {
  if (session) return { authenticated: true, hasAccount: !isDemoOwnerEmail(session.user.email) };
  const activeStoreId = storeIdSchema.safeParse(readCookie(cookieHeader, ACTIVE_STORE_COOKIE));
  if (!activeStoreId.success) return { authenticated: false, hasAccount: false };
  const [store] = await executor
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, activeStoreId.data), excludeDemoStores()))
    .limit(1);
  return { authenticated: false, hasAccount: Boolean(store) };
}

export async function marketingSessionResponse(
  request: Request,
  allowedOrigins: string[],
  readSession: () => Promise<MarketingSession>,
  onError: () => void,
): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  });
  const origin = originSchema.safeParse(request.headers.get("origin"));
  if (!origin.success || !allowedOrigins.includes(origin.data)) {
    return new Response(null, { status: 403, headers });
  }
  headers.set("Access-Control-Allow-Origin", origin.data);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  try {
    const { authenticated, hasAccount } = await readSession();
    return Response.json({ authenticated, hasAccount }, { headers });
  } catch {
    onError();
    return Response.json({ error: "session_unavailable" }, { status: 503, headers });
  }
}
