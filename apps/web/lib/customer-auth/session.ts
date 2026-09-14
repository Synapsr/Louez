import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";

import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { customerSessions, db, stores } from "@louez/db";

import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_DURATION_MS,
  buildCustomerSessionCookie,
  type CustomerSessionCookie,
} from "@/lib/customer-auth/cookie";

type SessionCustomer = NonNullable<Awaited<ReturnType<typeof db.query.customers.findFirst>>>;

export interface CustomerSession {
  customerId: string;
  customer: SessionCustomer;
}

/**
 * Inserts a session row and returns the cookie to set. Route handlers apply
 * it on their `NextResponse`; server actions go through
 * `createCustomerSession`, which sets it on the request cookie store.
 */
export const issueCustomerSession = async (customerId: string): Promise<CustomerSessionCookie> => {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_DURATION_MS);

  await db.insert(customerSessions).values({ customerId, token, expiresAt });

  return buildCustomerSessionCookie(token, expiresAt);
};

/** Server-action variant: issues the session and sets the cookie. */
export const createCustomerSession = async (customerId: string): Promise<void> => {
  const cookie = await issueCustomerSession(customerId);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
};

const readSessionFromCookie = async (storeId: string): Promise<CustomerSession | null> => {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
    if (!token) return null;

    const session = await db.query.customerSessions.findFirst({
      where: and(eq(customerSessions.token, token), gt(customerSessions.expiresAt, new Date())),
      with: { customer: true },
    });

    // A session is only valid on the store its customer belongs to.
    if (!session || session.customer.storeId !== storeId) return null;

    return { customerId: session.customer.id, customer: session.customer };
  } catch {
    return null;
  }
};

/**
 * The signed-in customer of `storeId`, or null. Memoised per request so the
 * layout, the page and a server action of one render share a single query.
 * Callers hold the id already (`getStoreBySlug`, oRPC `context.store.id`).
 */
export const getCustomerSession = cache(readSessionFromCookie);

/** Alias for the layout and the checkout page: prefill and display the customer. */
export const getCustomerSessionForStore = getCustomerSession;

/**
 * Slug-based shim for callers that only know the slug (oRPC context, the
 * advisor chat route). Costs one extra store read; prefer the id variant.
 */
export const getCustomerSessionBySlug = async (
  storeSlug: string,
): Promise<CustomerSession | null> => {
  const store = await db.query.stores.findFirst({
    columns: { id: true },
    where: eq(stores.slug, storeSlug),
  });

  return store ? getCustomerSession(store.id) : null;
};

/** Deletes the session row and clears the cookie. No-op without a cookie. */
export const destroyCustomerSession = async (): Promise<void> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return;

  await db.delete(customerSessions).where(eq(customerSessions.token, token));
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
};
