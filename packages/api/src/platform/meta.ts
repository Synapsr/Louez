import type { CredentialKind } from "./actor";
import type { ProcedureScope } from "./permissions";

/**
 * What a sensitive operation does, when it needs a confirmation from a
 * connection that asks for one (`api_keys.confirm_sensitive`).
 */
export type SensitiveKind = "money" | "destructive" | "send" | "spend";

/** How a procedure shows up as an MCP tool. */
export interface McpExposure {
  /** `domain_action`, stable. A breaking change takes a new name. */
  name: string;
  /** Written for a model: what it does, when to use it, what it returns. */
  description: string;
  /** Tool bundle the tool is listed in; the connection picks its bundles. */
  bundle: "daily" | "catalog" | "settings" | "integrations" | "team" | "billing";
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
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
