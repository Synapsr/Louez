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

/** How a procedure shows up as an MCP tool. */
export interface McpExposure {
  /** `domain_action`, stable. A breaking change takes a new name. */
  name: string;
  /** Written for a model: what it does, when to use it, what it returns. */
  description: string;
  /** Tool bundle the tool is listed in; the connection picks its bundles. */
  bundle: McpBundle;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /**
   * Names the tool had before it was served by this procedure. They stay
   * callable, never listed, so agents set up before the rename keep working;
   * `renamedArgs` maps an old argument name onto the new one, and
   * `fixedArgs` sets arguments the old tool implied (`archive_product` is
   * `products_update_status` with `status: "archived"`). Removed at the end
   * of the migration (lot 9).
   */
  aliases?: ReadonlyArray<{
    name: string;
    renamedArgs?: Readonly<Record<string, string>>;
    fixedArgs?: Readonly<Record<string, string | number | boolean>>;
  }>;
  /**
   * The tool takes a file's bytes in its arguments (base64): its MCP request
   * may be as large as `INLINE_FILE_REQUEST_MAX_BYTES` (packages/mcp
   * transports/http.ts), where every other request stops at 4 MiB.
   */
  inlineFile?: true;
  /**
   * false: a former tool that no alias can express (its offset paging), kept
   * as its own procedure for agents set up before. Callable on MCP, never
   * listed, not served on OpenAPI. Removed at the end of the migration (lot 9).
   */
  listed?: false;
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
  /** Exposed as an MCP tool, or excluded with the reason. Never left out silently. */
  mcp?: McpExposure | { exclude: string };
}
