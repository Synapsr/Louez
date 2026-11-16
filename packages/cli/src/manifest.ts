/**
 * What the CLI knows of the API: one entry per operation of the OpenAPI
 * document, generated from it (`manifest-builder.ts`) into
 * `manifest.generated.ts`, which is committed.
 */

/** How a flag's text becomes the value sent. */
export type FieldKind = "string" | "integer" | "number" | "boolean" | "json";

/** A path parameter, a query parameter or a top-level body field. */
export interface Field {
  /** The name the API reads. */
  name: string;
  /** The flag it is given with, without `--`: the name in kebab-case. */
  flag: string;
  kind: FieldKind;
  /** An array of `kind` values: the flag may repeat. */
  list?: true;
  /** `null` is one of its values. */
  nullable?: true;
  required?: true;
  enum?: string[];
  description?: string;
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof METHODS)[number];

export function isHttpMethod(method: string): method is HttpMethod {
  return METHODS.some((known) => known === method);
}

export interface Operation {
  /** The operation's `operationId`, also the name of its MCP tool. */
  id: string;
  /** `louez <group> <action>`. */
  group: string;
  action: string;
  method: HttpMethod;
  /** The path under the base URL, with `{name}` for each path parameter. */
  path: string;
  summary: string;
  description: string;
  /** In the order the path names them: the command's positional arguments. */
  pathParams: Field[];
  query: Field[];
  /** The JSON body it takes, and its top-level fields; null when it takes none. */
  body: { required: boolean; fields: Field[] } | null;
  /** It documents `Idempotency-Key`. */
  idempotent: boolean;
  /** It documents `Idempotency-Key` as required: a request without one is refused. */
  idempotencyRequired?: true;
  /** It documents `Louez-Confirmation`. */
  confirmation: boolean;
}

export interface Group {
  /** `louez <name> …`. */
  name: string;
  /** The reference's name for it, such as "Seasonal pricing". */
  title: string;
  description: string;
}

export interface Manifest {
  /** `info.version` of the document it was generated from. */
  apiVersion: string;
  groups: Group[];
  operations: Operation[];
}
