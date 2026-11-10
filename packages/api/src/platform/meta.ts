import type { CredentialKind } from "./actor";
import type { ProcedureScope } from "./permissions";

/**
 * What a sensitive operation does, when it needs a confirmation from a
 * connection that asks for one (`api_keys.confirm_sensitive`).
 */
export type SensitiveKind = "money" | "destructive" | "send" | "spend";

/**
 * Tool bundles. A connection's scopes say what it may call; its bundles say
 * which tools `tools/list` shows, so a model is not handed every tool at once.
 * An OAuth grant picks them on the consent page (`daily` by default); an API
 * key lists every bundle.
 */
export const MCP_BUNDLES = [
  "daily",
  "catalog",
  "settings",
  "integrations",
  "team",
  "billing",
] as const;
export type McpBundle = (typeof MCP_BUNDLES)[number];

/** The bundle a grant starts with. */
export const DEFAULT_MCP_BUNDLES: readonly McpBundle[] = ["daily"];

/** The longest tool name the Claude and ChatGPT directories accept. */
export const MCP_TOOL_NAME_MAX = 64;

/**
 * The hints every MCP tool carries, as explicit booleans: the Claude and
 * ChatGPT directories refuse a tool without them, and ChatGPT checks that they
 * match what the tool does.
 */
export interface McpToolAnnotations {
  /** Only reads: changes nothing in Louez or elsewhere. */
  readOnlyHint: boolean;
  /** A write that may overwrite or delete data already there, whether or not it can be undone. */
  destructiveHint: boolean;
  /** Reaches outside the user's Louez account: a customer, a provider, or the public storefront. */
  openWorldHint: boolean;
  /** Calling again with the same arguments changes nothing more. */
  idempotentHint?: boolean;
}

/**
 * What a write does to the data already there, which sets `destructiveHint`:
 *
 * - `additive`: it only adds (a new record, a new upload), and never replaces
 *   or clears anything; returning an existing record unchanged is additive;
 * - `overwrite`: it may replace or clear values already there (an update, a
 *   reorder, a status change, a link that replaces the previous one);
 * - `delete`: it removes records.
 */
export const MCP_EFFECTS = ["additive", "overwrite", "delete"] as const;
export type McpEffect = (typeof MCP_EFFECTS)[number];

/**
 * Why a tool reaches outside the user's Louez account, which sets
 * `openWorldHint`:
 *
 * - `customer`: it sends a customer a message (e-mail, SMS);
 * - `provider`: it calls a third party (Stripe, the insurer, a public registry);
 * - `public`: it changes what visitors of the store's online store see once
 *   it is online (the catalog, prices, availability, texts, its address).
 */
export const MCP_REACHES = ["customer", "provider", "public"] as const;
export type McpReach = (typeof MCP_REACHES)[number];

/**
 * The hints of a tool, from what its metadata says it does: read-only when it
 * does not write (`scope.level`), destructive when its write is not
 * `additive` (`effect`), open-world when it has a `reach`.
 */
export function mcpToolAnnotations(input: {
  level: "read" | "write" | undefined;
  effect: McpEffect | undefined;
  reach: McpReach | undefined;
  idempotentHint?: boolean;
}): McpToolAnnotations {
  const readOnlyHint = input.level !== "write";
  return {
    readOnlyHint,
    destructiveHint: !readOnlyHint && input.effect !== "additive",
    openWorldHint: input.reach !== undefined,
    ...(input.idempotentHint === undefined ? {} : { idempotentHint: input.idempotentHint }),
  };
}

/** How a procedure shows up as an MCP tool. */
export interface McpExposure {
  /** `domain_action`, stable, 64 characters at most. A breaking change takes a new name. */
  name: string;
  /** A short human title, in English Title Case, for clients to show: "List Reservations". */
  title: string;
  /**
   * Written for a model: what it does, what it takes and what it returns. It
   * describes the tool only: how an agent chains tools goes in the server's
   * instructions (packages/mcp/src/instructions.ts), never "call X" here.
   */
  description: string;
  /** Tool bundle the tool is listed in; the connection picks its bundles. */
  bundle: McpBundle;
  /** What a write does to the data already there; required on a write, refused on a read. */
  effect?: McpEffect;
  /** Why it reaches outside the user's Louez account; required with `sensitive: "send"`. */
  reach?: McpReach;
  /** The hint nothing else gives: calling again changes nothing more. */
  annotations?: { idempotentHint?: boolean };
  /**
   * The account's profile tool, which ChatGPT reads to tell accounts apart
   * (`_meta["openai/profile"]`): read-only, no argument, a stable `id`.
   */
  profile?: true;
  /**
   * How an agent's answer shows the output: a page of a long list, such as a
   * product's units (`answerPage`). The MCP bridge applies it after the
   * call, a replay included, so the procedure returns, and an idempotency
   * key stores, the whole output, which every other transport gets.
   */
  answer?: (output: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Metadata of every procedure of the agent-ready API. The store middleware
 * reads `scope`, `actors` and `sensitive`; the MCP bridge reads `mcp`; the
 * operations middleware records writes under `capability`.
 */
export interface ApiMeta {
  /** Capability id from platform/inventory.ts, e.g. `categories.create`. */
  capability?: string;
  scope?: ProcedureScope;
  /**
   * An account procedure (`accountProcedure`): it acts before any store, for
   * the connection's own account and stores only (`stores_list`,
   * `stores_create`). Without `scope`, every connection may call it. With
   * one, the connection's scopes alone decide (there is no role), and a write
   * is recorded on the account scope (`accountRefusal`, `ACCOUNT_SCOPE`).
   */
  account?: true;
  /** Credentials allowed to call it. Default: every credential the transport accepts. */
  actors?: readonly CredentialKind[];
  /** Platform staff only, from a dashboard session. */
  platformAdmin?: boolean;
  sensitive?: SensitiveKind;
  /**
   * The output holds a secret (a new API key): it is never stored, so an
   * idempotency key is ignored and the call is only recorded.
   */
  secretOutput?: boolean;
  /**
   * Largest request body this procedure legitimately takes, when it is more
   * than the transports take by default (2 MiB on `/api/v1`, 4 MiB on
   * `/api/mcp`): an image's bytes, a product with a thousand units. Both
   * transports read up to it for this procedure only (`routeBodyLimits` in
   * platform/openapi.ts, the MCP door in packages/mcp transports/http.ts).
   */
  maxBodyBytes?: number;
  /** Exposed as an MCP tool, or excluded with the reason. Never left out silently. */
  mcp?: McpExposure | { exclude: string };
}
