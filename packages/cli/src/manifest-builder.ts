/**
 * Builds the command manifest from the API's OpenAPI document. Used by
 * `scripts/generate-manifest.ts` and by the tests; the CLI itself reads only
 * the committed result.
 *
 * Naming rule. The group is the operation's tag (the reference's menu group)
 * in kebab-case: "Seasonal pricing" is `seasonal-pricing`. The action is the
 * operationId's words, without its leading words when they name a group
 * (`products_` in `products_list_variants`), and without the words of its own
 * group, singular or plural (`variants`): `louez variants list`. When nothing
 * is left, or two operations of a group would share an action, each of them
 * takes its whole operationId in kebab-case instead.
 */
import { BUILT_IN_COMMANDS, isGlobalFlag } from "./globals.js";
import type { Field, FieldKind, Group, HttpMethod, Manifest, Operation } from "./manifest.js";

type Schema = Record<string, unknown>;

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<Parameter | { $ref: string }>;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Schema }> };
}

export interface OpenApiDocument {
  info: { version: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { parameters?: Record<string, Parameter> };
}

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** `categoryIds` → `category-ids`, `Online store` → `online-store`. */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/** One word for another, singular or plural: `unit` and `units`, `category` and `categories`. */
function sameWord(a: string, b: string): boolean {
  const singular = (word: string) =>
    word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.replace(/s$/, "");
  return singular(a) === singular(b);
}

function startsWithWords(words: string[], prefix: string[]): boolean {
  return prefix.length <= words.length && prefix.every((word, i) => sameWord(words[i]!, word));
}

/** The action of an operation of `group`, before collisions are resolved; null when nothing is left. */
function actionName(operationId: string, group: string[], allGroups: string[][]): string | null {
  let words = operationId.split("_").filter(Boolean);
  // The longest group name that leads the id.
  const leading = allGroups
    .filter((name) => startsWithWords(words, name))
    .sort((a, b) => b.length - a.length)[0];
  if (leading) words = words.slice(leading.length);
  const at = words.findIndex((_, i) => startsWithWords(words.slice(i), group));
  if (at !== -1) words = [...words.slice(0, at), ...words.slice(at + group.length)];
  return words.length > 0 ? words.join("-") : null;
}

/** How a JSON schema's value is read from a flag's text. */
export function fieldShape(
  schema: Schema | undefined,
): Pick<Field, "kind" | "list" | "nullable" | "enum"> {
  if (!schema) return { kind: "json" };
  const branches = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (Array.isArray(branches)) {
    const nonNull = branches.filter((branch) => branch.type !== "null");
    const nullable = nonNull.length < branches.length ? { nullable: true as const } : {};
    if (nonNull.length === 1) return { ...fieldShape(nonNull[0]), ...nullable };
    const kinds = new Set(nonNull.map((branch) => scalarKind(branch)));
    let kind: FieldKind;
    if (kinds.has("json")) kind = "json";
    else if (kinds.size === 1) kind = [...kinds][0]!;
    else if ([...kinds].every((k) => k === "integer" || k === "number")) kind = "number";
    else if (kinds.has("boolean") && nonNull.every(isBooleanLike)) kind = "boolean";
    else kind = "string";
    return { kind, ...nullable };
  }
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type];
  if (types.length > 1) {
    const nonNull = types.filter((type) => type !== "null");
    const nullable = nonNull.length < types.length ? { nullable: true as const } : {};
    if (nonNull.length === 1)
      return { ...fieldShape({ ...schema, type: nonNull[0] }), ...nullable };
    return { kind: "json", ...nullable };
  }
  if (schema.type === "array") {
    const items = schema.items as Schema | undefined;
    const item = fieldShape(items);
    if (item.kind === "json" || item.list || item.nullable) return { kind: "json" };
    return { ...item, list: true };
  }
  const kind = scalarKind(schema);
  const values = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (kind === "string" && values?.every((value) => typeof value === "string")) {
    return { kind, enum: values as string[] };
  }
  return { kind };
}

function scalarKind(schema: Schema): FieldKind {
  if ("const" in schema) return kindOfValue(schema.const);
  switch (schema.type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return schema.type;
    default:
      if (Array.isArray(schema.enum) && schema.enum.length > 0) return kindOfValue(schema.enum[0]);
      return "json";
  }
}

function kindOfValue(value: unknown): FieldKind {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "json";
}

/** A boolean, or the strings `true` and `false`. */
function isBooleanLike(schema: Schema): boolean {
  if (schema.type === "boolean") return true;
  const values = Array.isArray(schema.enum) ? schema.enum : "const" in schema ? [schema.const] : [];
  return values.length > 0 && values.every((value) => value === "true" || value === "false");
}

function field(
  name: string,
  schema: Schema | undefined,
  required: boolean,
  description: string | undefined,
): Field {
  const text =
    description ?? (typeof schema?.description === "string" ? schema.description : undefined);
  return {
    name,
    flag: kebabCase(name),
    ...fieldShape(schema),
    ...(required ? { required: true as const } : {}),
    ...(text ? { description: text } : {}),
  };
}

function resolveParameter(
  document: OpenApiDocument,
  parameter: Parameter | { $ref: string },
): Parameter {
  if (!("$ref" in parameter)) return parameter;
  const name = parameter.$ref.replace("#/components/parameters/", "");
  const resolved = document.components?.parameters?.[name];
  if (!resolved) throw new Error(`Unresolved parameter ${parameter.$ref}`);
  return resolved;
}

export function buildManifest(document: OpenApiDocument): Manifest {
  const tagNames = new Set<string>();
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) {
      const tag = operation.tags?.[0];
      if (tag) tagNames.add(tag);
    }
  }
  const groupWords = [...tagNames].map((tag) => kebabCase(tag).split("-"));

  const operations: Operation[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [lowerMethod, source] of Object.entries(methods)) {
      const method = lowerMethod.toUpperCase() as HttpMethod;
      if (!METHODS.includes(method)) continue;
      const id = source.operationId;
      if (!id) throw new Error(`${method} ${path} has no operationId`);
      const tag = source.tags?.[0];
      if (!tag) throw new Error(`${id} has no tag: the CLI names its group after it`);
      const group = kebabCase(tag);
      if ((BUILT_IN_COMMANDS as readonly string[]).includes(group)) {
        throw new Error(`The tag of ${id} gives the group "${group}", a built-in command`);
      }

      const parameters = (source.parameters ?? []).map((parameter) =>
        resolveParameter(document, parameter),
      );
      const pathOrder = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
      const pathParams = pathOrder.map((name) => {
        const parameter = parameters.find((p) => p.in === "path" && p.name === name);
        return field(name, parameter?.schema ?? { type: "string" }, true, parameter?.description);
      });
      const query = parameters
        .filter((p) => p.in === "query")
        .map((p) => field(p.name, p.schema, p.required === true, p.description));
      const headers = new Set(parameters.filter((p) => p.in === "header").map((p) => p.name));

      const json = source.requestBody?.content?.["application/json"];
      let body: Operation["body"] = null;
      if (source.requestBody) {
        if (!json) throw new Error(`${id} takes a body the CLI cannot send (not application/json)`);
        const schema = json.schema ?? {};
        const required = new Set(
          Array.isArray(schema.required) ? (schema.required as string[]) : [],
        );
        const properties =
          schema.type === "object" && schema.properties
            ? (schema.properties as Record<string, Schema>)
            : {};
        body = {
          required: source.requestBody.required === true,
          fields: Object.entries(properties).map(([name, property]) =>
            field(name, property, required.has(name), undefined),
          ),
        };
      }

      const flags = [...query, ...(body?.fields ?? [])];
      const seen = new Set<string>();
      for (const { flag, name } of flags) {
        if (isGlobalFlag(flag) || flag.startsWith("no-")) {
          throw new Error(
            `${id}: the field "${name}" would be the flag --${flag}, which the CLI keeps`,
          );
        }
        if (seen.has(flag)) throw new Error(`${id}: two fields share the flag --${flag}`);
        seen.add(flag);
      }

      operations.push({
        id,
        group,
        action: actionName(id, group.split("-"), groupWords) ?? kebabCase(id),
        method,
        path,
        summary: source.summary ?? id,
        description: source.description ?? "",
        pathParams,
        query,
        body,
        idempotent: headers.has("Idempotency-Key"),
        confirmation: headers.has("Louez-Confirmation"),
      });
    }
  }

  // Two operations of a group with one action: each takes its whole id.
  const byCommand = new Map<string, Operation[]>();
  for (const operation of operations) {
    const command = `${operation.group} ${operation.action}`;
    byCommand.set(command, [...(byCommand.get(command) ?? []), operation]);
  }
  for (const shared of byCommand.values()) {
    if (shared.length > 1)
      for (const operation of shared) operation.action = kebabCase(operation.id);
  }

  const groups: Group[] = (document.tags ?? [])
    .filter((tag) => tagNames.has(tag.name))
    .map((tag) => ({
      name: kebabCase(tag.name),
      title: tag.name,
      description: tag.description ?? "",
    }));
  for (const tag of tagNames) {
    if (!groups.some((group) => group.title === tag)) {
      groups.push({ name: kebabCase(tag), title: tag, description: "" });
    }
  }

  return { apiVersion: document.info.version, groups, operations };
}

/** The text of `manifest.generated.ts`. */
export function renderManifestModule(manifest: Manifest): string {
  return `// Generated from the Louez API's OpenAPI document by scripts/generate-manifest.ts.
// Do not edit: after changing the API, run \`pnpm --filter ./packages/cli generate\`.
import type { Manifest } from "./manifest.js";

export const manifest: Manifest = ${JSON.stringify(manifest, null, 2)};
`;
}
