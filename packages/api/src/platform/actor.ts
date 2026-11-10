import { db, storeMembers, stores } from "@louez/db";
import { isPlatformAdmin } from "@louez/auth/platform-admin";
import type { MemberRole } from "@louez/utils";
import { and, asc, eq, inArray } from "drizzle-orm";

import { loadActiveGrant } from "../services/agent-grants";
import { validateApiKey } from "../services/api-keys";
import {
  clientDirectory,
  clientWithholding,
  modelReadsStructuredContent,
  type ClientDirectory,
  type ClientWithholding,
} from "./agent-clients";
import { platformErrors } from "./errors";
import type { McpBundle } from "./meta";
import { normalizeScopes, presetScopes, type ConnectionScopes } from "./permissions";

/** The three ways into the API. */
export type Transport = "rpc" | "openapi" | "mcp";
export type CredentialKind = "session" | "api_key" | "oauth";

/**
 * What each transport accepts. A credential a transport does not accept is
 * refused; it never falls back to another one (no cookie behind a bad token).
 */
export const ACCEPTED_CREDENTIALS: Record<Transport, readonly CredentialKind[]> = {
  rpc: ["session"],
  openapi: ["api_key"],
  mcp: ["api_key", "oauth"],
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
  /**
   * The only store the connection works on: an API key's store, or the one
   * store of an OAuth grant. Null when the caller picks.
   */
  storeId: string | null;
  /**
   * The stores an OAuth grant covers. Null for a grant over every store of
   * the user (current and future ones), and for a session or an API key.
   */
  stores: readonly string[] | null;
  /** What the connection was granted; null for a session (the role alone applies). */
  scopes: ConnectionScopes | null;
  /** Sensitive operations wait for a confirmation. Always false for a session: the dashboard has its own dialogs. */
  confirmSensitive: boolean;
  /** The tool bundles MCP lists for an OAuth grant; null lists them all (session, API key). */
  bundles: readonly McpBundle[] | null;
  /**
   * What the OAuth client never reaches, whatever the grant, as its
   * directory forbids it (`clientWithholding`): its domains are `none` in
   * `scopes` and its bundles left out of `bundles`. Absent: nothing.
   */
  withheld?: ClientWithholding;
  /**
   * The OAuth client gives its model a tool result's structured content
   * (`modelReadsStructuredContent`): MCP answers leave its JSON out of the
   * text block. Absent: the text repeats it.
   */
  structuredContentOnly?: boolean;
  /** The OAuth client's directory (`clientDirectory`), for error tracking. Absent: not OAuth. */
  directory?: ClientDirectory;
}

/** Someone authenticated, before any store is chosen. */
export interface AccountActor {
  transport: Transport;
  credential: Credential;
  isPlatformAdmin: boolean;
}

/**
 * The store id an account write is recorded under (`api_operations`,
 * `api_confirmations`): none, as the account acts before any store, such as
 * creating one or granting an agent. Idempotency keys and confirmation
 * tokens stay scoped to the user's connection.
 */
export const ACCOUNT_SCOPE = "";

/** Someone whose write is recorded: on a store, or on the account (`ACCOUNT_SCOPE`). */
export interface ScopedActor extends AccountActor {
  storeId: string;
}

/** Someone acting on one store, with the role they hold there now. */
export interface StoreActor extends ScopedActor {
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

  if (token !== null && !token.startsWith(API_KEY_PREFIX)) {
    if (!accepted.includes("oauth")) throw platformErrors.credentialNotAccepted(input.transport);
    return resolveOAuthActor(input.transport, token);
  }

  if (token !== null) {
    if (!accepted.includes("api_key")) throw platformErrors.credentialNotAccepted(input.transport);
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
        stores: null,
        scopes: normalizeScopes(key.permissions),
        confirmSensitive: key.confirmSensitive,
        bundles: null,
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
      stores: null,
      scopes: null,
      confirmSensitive: false,
      bundles: null,
    },
  };
}

/** How an access token is verified. Better Auth by default; tests replace the module. */
async function verifyAccessToken(token: string) {
  const { verifyMcpAccessToken } = await import("@louez/auth");
  return verifyMcpAccessToken(token);
}

/**
 * An OAuth access token, checked in full: signature, issuer, audience (the
 * MCP resource), expiry and type, then the grant the user accepted for that
 * client, read again now, which must be the very grant the token names. A
 * revoked grant or a disabled client refuses the call; nothing falls back to
 * another credential.
 */
async function resolveOAuthActor(transport: Transport, token: string): Promise<AccountActor> {
  const verified = await verifyAccessToken(token);
  if (!verified) {
    throw platformErrors.unauthenticated("This access token is invalid or expired.");
  }
  const grant = await loadActiveGrant({ userId: verified.userId, clientId: verified.clientId });
  // The token must be one of this grant's: a token issued before a revoke
  // names the old grant, and never acts for the one made on reconnecting.
  if (!grant || grant.id !== verified.grantId) {
    throw platformErrors.unauthenticated(
      "This connection was revoked, or its client is no longer allowed. Connect again.",
    );
  }
  // What the client's directory forbids is out of reach, whatever the grant.
  // The client as it registered, as the consent page reads it: never the
  // name cut for the audit trail, and its registered redirect URIs.
  const client = {
    clientId: grant.clientId,
    name: grant.registeredName,
    redirectUris: grant.redirectUris,
  };
  const withheld = clientWithholding(client);
  const scopes = presetScopes(grant.preset);
  for (const domain of withheld.domains) scopes[domain] = "none";
  return {
    transport,
    // A connected agent acts for its user's memberships, never as platform staff.
    isPlatformAdmin: false,
    credential: {
      kind: "oauth",
      id: grant.id,
      clientName: grant.clientName,
      userId: grant.userId,
      email: grant.email,
      storeId: grant.stores?.length === 1 ? grant.stores[0] : null,
      stores: grant.stores,
      scopes,
      confirmSensitive: grant.confirmSensitive,
      bundles: grant.bundles.filter((bundle) => !withheld.bundles.includes(bundle)),
      withheld,
      structuredContentOnly: modelReadsStructuredContent(client),
      directory: clientDirectory(client),
    },
  };
}

/** The dashboard's active store, from a session request's cookie. */
export function activeStoreIdOf(headers: Headers): string | null {
  return cookieValue(headers, ACTIVE_STORE_COOKIE);
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
 * - API key, or a grant over one store: that store, through the user's
 *   current membership. `requestedStoreId` must match it.
 * - OAuth grant over several stores: `requestedStoreId` (the `Louez-Store`
 *   header, or the `storeId` argument of a tool), among the granted stores
 *   the user is still a member of. Without it, the one such store when there
 *   is one; otherwise STORE_REQUIRED.
 * - Session: the dashboard's active store cookie, else the first store, like
 *   `getCurrentStore`. Platform staff may open any store.
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

  if (credential.kind === "oauth") {
    const reachable = await connectionStores(actor);
    if (input.requestedStoreId) {
      const chosen = reachable.find((store) => store.id === input.requestedStoreId);
      if (!chosen) throw platformErrors.noStore();
      return { ...actor, storeId: chosen.id, role: chosen.role };
    }
    if (reachable.length === 1)
      return { ...actor, storeId: reachable[0].id, role: reachable[0].role };
    if (reachable.length === 0) throw platformErrors.noStore();
    throw platformErrors.storeRequired();
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

/** A store a connection may act on, with the role the user holds there now. */
export interface ReachableStore {
  id: string;
  name: string;
  slug: string;
  /** Whether its storefront is online: a store in onboarding has none. */
  onboardingCompleted: boolean | null;
  role: MemberRole;
}

/**
 * The stores a connection may act on now, by name: an API key's store, a
 * grant's stores (or all of the user's), a session's memberships. Each one
 * through the user's current membership, so a store they left drops out.
 */
export async function connectionStores(actor: AccountActor): Promise<ReachableStore[]> {
  const { credential } = actor;
  const only = credential.storeId ? [credential.storeId] : credential.stores;
  if (only && only.length === 0) return [];
  const rows = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      onboardingCompleted: stores.onboardingCompleted,
      role: storeMembers.role,
    })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(
      only
        ? and(eq(storeMembers.userId, credential.userId), inArray(storeMembers.storeId, [...only]))
        : eq(storeMembers.userId, credential.userId),
    )
    .orderBy(asc(stores.name), asc(stores.id));
  return rows.map((row) => ({ ...row, role: row.role as MemberRole }));
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
