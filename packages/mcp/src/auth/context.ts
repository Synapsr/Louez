import type { StoreActor } from "@louez/api/platform/actor";
import { platformErrors } from "@louez/api/platform/errors";
import type { McpBundle } from "@louez/api/platform/meta";
import {
  accountRefusal,
  allows,
  type ApiDomain,
  type ProcedureScope,
} from "@louez/api/platform/permissions";
import type { MemberRole } from "@louez/utils";
import type { ApiPorts } from "@louez/api/platform/ports";
import type { Permission } from "@louez/utils";

/**
 * Who calls, resolved again for every HTTP request: a revoked key, a removed
 * member or a lower role applies on the next request. Tools, resources and
 * prompts read it; nothing outlives the request. Built by `resolveMcpContext`
 * (auth/resolve.ts).
 */
export interface McpRequestContext {
  /**
   * The store actor of the request. When no store is chosen (`storeChosen`
   * false), the first store the connection reaches: tools are listed from it
   * but a call that needs a store is refused with STORE_REQUIRED. When the
   * connection reaches no store (`noStore`), a stand-in on no store
   * (`ACCOUNT_SCOPE`), never acted on: every store tool answers `storeError`.
   */
  actor: StoreActor;
  /**
   * A store is known: the connection has one (an API key, a grant over one
   * store), or the request named one (the `Louez-Store` header, or the
   * `storeId` argument of its tool call).
   */
  storeChosen: boolean;
  /** The connection covers several stores: a store tool needs a `storeId` argument. */
  multiStore: boolean;
  /** The connection reaches no store yet: only the account tools can run. */
  noStore: boolean;
  /**
   * Store tools take a `storeId` argument: the connection covers several
   * stores, or every store of the user (it may create one).
   */
  storeArgument: boolean;
  /**
   * Why the store a tool call named cannot be used (not a store of the
   * connection): the call answers with it instead of running.
   */
  storeError: Error | null;
  /**
   * The role tools are listed with: the highest the user holds among the
   * stores reached, or owner for a connection that reaches none yet.
   */
  listingRole: MemberRole;
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

/**
 * Whether `tools/list` shows a store tool: it is in one of the connection's
 * bundles (an API key lists them all), and the listing role cut down to the
 * connection's scopes allows its scope. Listing only shows: the call is
 * authorized where it runs. Account tools: `isAccountToolListed`.
 */
export function isListed(
  ctx: McpRequestContext,
  scope: ProcedureScope,
  bundle: McpBundle,
): boolean {
  const { bundles, scopes } = ctx.actor.credential;
  if (bundles && !bundles.includes(bundle)) return false;
  return allows(ctx.listingRole, scopes, scope);
}

/**
 * Whether `tools/list` shows an account tool (`stores_list`,
 * `stores_create`): whatever the bundles, when the connection may call it
 * (`accountRefusal`). A connection with no store yet sees how to create one.
 */
export function isAccountToolListed(
  ctx: McpRequestContext,
  scope: ProcedureScope | undefined,
): boolean {
  return !scope || accountRefusal(ctx.actor.credential, scope) === null;
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
