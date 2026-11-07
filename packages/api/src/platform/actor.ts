import { db, storeMembers, stores } from "@louez/db";
import { isPlatformAdmin } from "@louez/auth/platform-admin";
import type { MemberRole } from "@louez/utils";
import { and, asc, eq } from "drizzle-orm";

import { validateApiKey } from "../services/api-keys";
import { platformErrors } from "./errors";
import { normalizeScopes, type ConnectionScopes } from "./permissions";

/** The three ways into the API. */
export type Transport = "rpc" | "openapi" | "mcp";
export type CredentialKind = "session" | "api_key" | "oauth";

/**
 * What each transport accepts. A credential a transport does not accept is
 * refused; it never falls back to another one (no cookie behind a bad token).
 * OAuth joins `mcp` with lot 1.
 */
export const ACCEPTED_CREDENTIALS: Record<Transport, readonly CredentialKind[]> = {
  rpc: ["session"],
  openapi: ["api_key"],
  mcp: ["api_key"],
};

const API_KEY_PREFIX = "lz_";
const ACTIVE_STORE_COOKIE = "louez_active_store";

export interface Credential {
  kind: CredentialKind;
  /** API key id or OAuth grant id; null for a session. */
  id: string | null;
  /** Verified name to show in the audit trail: the key's name, the OAuth client. */
  clientName: string | null;
  userId: string;
  email: string | null;
  /** The only store an API key works on; null when the caller picks. */
  storeId: string | null;
  /** What the connection was granted; null for a session (the role alone applies). */
  scopes: ConnectionScopes | null;
  /** Sensitive operations wait for a confirmation. Always false for a session: the dashboard has its own dialogs. */
  confirmSensitive: boolean;
}

/** Someone authenticated, before any store is chosen. */
export interface AccountActor {
  transport: Transport;
  credential: Credential;
  isPlatformAdmin: boolean;
}

/** Someone acting on one store, with the role they hold there now. */
export interface StoreActor extends AccountActor {
  storeId: string;
  role: MemberRole;
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/** How a request's session cookie is read. Better Auth by default; tests replace it. */
export type SessionReader = (headers: Headers) => Promise<SessionUser | null>;

export const readBetterAuthSession: SessionReader = async (headers) => {
  const { authInstance } = await import("@louez/auth");
  const session = await authInstance.api.getSession({ headers });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email ?? null };
};

function bearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : "";
}

/**
 * Who is calling, checked on every request. A credential that is present but
 * invalid fails; an accepted credential missing fails.
 */
export async function resolveAccountActor(input: {
  transport: Transport;
  headers: Headers;
  readSession?: SessionReader;
}): Promise<AccountActor> {
  const accepted = ACCEPTED_CREDENTIALS[input.transport];
  const token = bearerToken(input.headers);

  if (token !== null) {
    if (!token.startsWith(API_KEY_PREFIX) || !accepted.includes("api_key")) {
      throw platformErrors.credentialNotAccepted(input.transport);
    }
    const key = await validateApiKey({ db, rawKey: token });
    if (!key) throw platformErrors.unauthenticated("This API key is invalid, expired or revoked.");

    const user = await db.query.users.findFirst({
      where: (users, { eq: equals }) => equals(users.id, key.userId),
      columns: { id: true, email: true },
    });
    if (!user) throw platformErrors.unauthenticated("This API key's owner no longer exists.");

    return {
      transport: input.transport,
      // An API key acts for its owner's membership, never as platform staff.
      isPlatformAdmin: false,
      credential: {
        kind: "api_key",
        id: key.apiKeyId,
        clientName: key.name,
        userId: user.id,
        email: user.email,
        storeId: key.storeId,
        scopes: normalizeScopes(key.permissions),
        confirmSensitive: key.confirmSensitive,
      },
    };
  }

  if (!accepted.includes("session")) throw platformErrors.unauthenticated();

  const user = await (input.readSession ?? readBetterAuthSession)(input.headers);
  if (!user) throw platformErrors.unauthenticated();

  return {
    transport: input.transport,
    isPlatformAdmin: isPlatformAdmin(user.email),
    credential: {
      kind: "session",
      id: null,
      clientName: null,
      userId: user.id,
      email: user.email,
      storeId: null,
      scopes: null,
      confirmSensitive: false,
    },
  };
}

function cookieValue(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * The store an actor acts on, and the role they hold there now, read on every
 * call: a member removed or demoted loses access on their next request.
 *
 * - API key: its store, through its owner's current membership.
 * - Session: the dashboard's active store cookie, else the first store, like
 *   `getCurrentStore`. Platform staff may open any store.
 * - `requestedStoreId` (OAuth grants over several stores, lot 1) must match.
 */
export async function resolveStoreActor(
  actor: AccountActor,
  input: { headers: Headers; requestedStoreId?: string },
): Promise<StoreActor> {
  const { credential } = actor;

  if (credential.storeId) {
    if (input.requestedStoreId && input.requestedStoreId !== credential.storeId) {
      throw platformErrors.noStore();
    }
    const role = await memberRole(credential.storeId, credential.userId);
    if (!role) throw platformErrors.noStore();
    return { ...actor, storeId: credential.storeId, role };
  }

  const wanted = input.requestedStoreId ?? cookieValue(input.headers, ACTIVE_STORE_COOKIE);
  if (wanted) {
    const role = await memberRole(wanted, credential.userId);
    if (role) return { ...actor, storeId: wanted, role };
    if (actor.isPlatformAdmin && credential.kind === "session" && (await storeExists(wanted))) {
      return { ...actor, storeId: wanted, role: "platform_admin" };
    }
    if (input.requestedStoreId) throw platformErrors.noStore();
  }

  // No usable choice: the first store by name, as the dashboard's
  // `getCurrentStore` falls back. For platform staff that is the first store
  // of all, with their own role where they are a member.
  if (actor.isPlatformAdmin && credential.kind === "session") {
    const [first] = await db
      .select({ id: stores.id })
      .from(stores)
      .orderBy(asc(stores.name))
      .limit(1);
    if (!first) throw platformErrors.noStore();
    return {
      ...actor,
      storeId: first.id,
      role: (await memberRole(first.id, credential.userId)) ?? "platform_admin",
    };
  }

  const [first] = await db
    .select({ storeId: storeMembers.storeId, role: storeMembers.role })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(eq(storeMembers.userId, credential.userId))
    .orderBy(asc(stores.name))
    .limit(1);
  if (!first) throw platformErrors.noStore();
  return { ...actor, storeId: first.storeId, role: first.role as MemberRole };
}

async function memberRole(storeId: string, userId: string): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId)))
    .limit(1);
  return (row?.role as MemberRole | undefined) ?? null;
}

async function storeExists(storeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return Boolean(row);
}
