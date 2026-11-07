import type { ApiKeyPermissions } from "@louez/db";
import { hasPermission, type MemberRole, type Permission } from "@louez/utils";

/**
 * What a connection (API key, OAuth grant) may touch, domain by domain. A
 * dashboard session has no such limit: only the member's role applies.
 */
export const API_DOMAINS = [
  "reservations",
  "products",
  "customers",
  "categories",
  "payments",
  "analytics",
  "settings",
  "online_store",
  "integrations",
  "team",
  "billing",
] as const;

export type ApiDomain = (typeof API_DOMAINS)[number];
export type ScopeLevel = "none" | "read" | "write";
export type ConnectionScopes = Record<ApiDomain, ScopeLevel>;

const LEVEL_RANK: Record<ScopeLevel, number> = { none: 0, read: 1, write: 2 };

/**
 * Reads stored permissions. A domain that is missing, or holds a value this
 * code does not know, is `none`: a key created before a domain existed never
 * gains it.
 */
export function normalizeScopes(
  raw: Partial<ApiKeyPermissions> | null | undefined,
): ConnectionScopes {
  const scopes = {} as ConnectionScopes;
  for (const domain of API_DOMAINS) {
    const value = (raw as Record<string, unknown> | null | undefined)?.[domain];
    scopes[domain] = value === "read" || value === "write" ? value : "none";
  }
  // Analytics is read-only whatever was stored.
  if (scopes.analytics === "write") scopes.analytics = "read";
  return scopes;
}

/** What a procedure needs: a domain, a level, and the member permission behind it. */
export interface ProcedureScope {
  domain: ApiDomain;
  level: "read" | "write";
  /**
   * The member permission the action needs. Defaults to `read` for reads and
   * `write` for writes; deletions ask `delete`, store settings
   * `manage_settings`, the team `manage_members`.
   */
  role?: Permission;
}

/**
 * The effective right of an actor: what the member's role allows, cut down to
 * what the connection was granted. `scopes` is null for a dashboard session.
 */
export function allows(
  role: MemberRole,
  scopes: ConnectionScopes | null,
  required: ProcedureScope,
): boolean {
  const permission = required.role ?? (required.level === "read" ? "read" : "write");
  if (!hasPermission(role, permission)) return false;
  if (!scopes) return true;
  return LEVEL_RANK[scopes[required.domain]] >= LEVEL_RANK[required.level];
}
