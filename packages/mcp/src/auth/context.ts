import type { StoreActor } from "@louez/api/platform/actor";
import { platformErrors } from "@louez/api/platform/errors";
import { allows, type ApiDomain } from "@louez/api/platform/permissions";
import type { ApiPorts } from "@louez/api/platform/ports";
import type { Permission } from "@louez/utils";

/**
 * Who calls, resolved again for every HTTP request: a revoked key, a removed
 * member or a lower role applies on the next request. Tools, resources and
 * prompts read it; nothing outlives the request. Built by `resolveMcpContext`
 * (auth/resolve.ts).
 */
export interface McpRequestContext {
  actor: StoreActor;
  /** The actor's store and user, for short. */
  storeId: string;
  userId: string;
  storeName: string;
  /** The request's headers. The bridge forwards its credential to the procedures. */
  headers: Headers;
  ports: ApiPorts;
  /** Counts one call on the connection's rate limit, shared with every transport. */
  countCall: () => Promise<void>;
}

/**
 * Whether the actor may do this: the member's role, cut down to the
 * connection's scopes. A domain missing from a key's permissions is `none`.
 * `role` is the member permission behind it, as the dashboard asks
 * (`manage_settings` for store settings).
 */
export function hasPermission(
  ctx: McpRequestContext,
  domain: ApiDomain,
  level: "read" | "write",
  role?: Permission,
): boolean {
  return allows(ctx.actor.role, ctx.actor.credential.scopes, { domain, level, role });
}

/** Throws PERMISSION_DENIED unless the actor may do this (see `hasPermission`). */
export function requirePermission(
  ctx: McpRequestContext,
  domain: ApiDomain,
  level: "read" | "write",
  role?: Permission,
): void {
  if (!hasPermission(ctx, domain, level, role)) {
    throw platformErrors.permissionDenied(`${domain}:${level}`);
  }
}
