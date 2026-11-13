import type { OpenAPI } from "@orpc/contract";
import { isProcedure, Procedure, type AnyProcedure, type AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import {
  MCP_BUNDLES,
  MCP_TOOL_NAME_MAX,
  type ApiMeta,
  type McpBundle,
  type McpExposure,
} from "./meta";
import type { ProcedureScope } from "./permissions";

/**
 * The procedures the OpenAPI and MCP transports serve, by router path. The RPC
 * endpoint serves the whole router to the dashboard; these two serve only what
 * is listed here. Each line is reviewed: a procedure enters when its contract
 * follows docs/architecture/api-and-agents.md.
 */
export const EXPOSED_PROCEDURES: readonly string[] = [
  "dashboard.categories.list",
  "dashboard.categories.get",
  "dashboard.categories.create",
  "dashboard.categories.update",
  "dashboard.categories.delete",
  "dashboard.categories.reorder",
  "dashboard.categories.createImageUpload",
  "dashboard.categories.completeImageUpload",
  "dashboard.categories.uploadImage",
  "dashboard.products.list",
  "dashboard.products.get",
  "dashboard.products.listUnits",
  "dashboard.products.create",
  "dashboard.products.update",
  "dashboard.products.updateStatus",
  "dashboard.products.delete",
  "dashboard.products.duplicate",
  "dashboard.products.reorder",
  "dashboard.products.createImageUpload",
  "dashboard.products.completeImageUpload",
  "dashboard.products.uploadImage",
  "dashboard.products.enhanceImage",
  "dashboard.products.removeImageBackground",
  "dashboard.products.useImageVersion",
  "dashboard.products.getActivity",
  "dashboard.products.getReservationTimeline",
  "dashboard.products.listSeasonalPricings",
  "dashboard.products.createSeasonalPricing",
  "dashboard.products.updateSeasonalPricing",
  "dashboard.products.duplicateSeasonalPricing",
  "dashboard.products.deleteSeasonalPricing",
  "dashboard.products.getUnitHistory",
  "dashboard.products.declareDowntime",
  "dashboard.products.updateDowntime",
  "dashboard.products.closeDowntime",
  "dashboard.products.deleteDowntime",
  "dashboard.products.retireUnit",
  "dashboard.products.reinstateUnit",
  "dashboard.products.updateUnitDetails",
  "dashboard.products.listVariants",
  "dashboard.products.ensureVariantDefinition",
  "dashboard.products.updateVariantDefinition",
  "dashboard.products.setVariantDefinitionActive",
  "dashboard.products.deleteVariantDefinition",
  "dashboard.products.getVariantUsage",
  "dashboard.products.withdrawVariantFromProducts",
  "dashboard.products.createVariantValue",
  "dashboard.products.updateVariantValue",
  "dashboard.products.deleteVariantValue",
  "dashboard.reservations.list",
  "dashboard.reservations.get",
  "dashboard.reservations.poll",
  "dashboard.reservations.listCalendarPeriod",
  "dashboard.reservations.getPlanningTimeline",
  "dashboard.reservations.listUpcoming",
  "dashboard.reservations.listOverdue",
  "dashboard.reservations.updateStatus",
  "dashboard.reservations.cancel",
  "dashboard.reservations.updateNotes",
  "dashboard.onlineStore.update",
  "dashboard.onlineStore.checkSlugAvailability",
  "dashboard.onlineStore.updateSlug",
  "dashboard.onlineStore.updateAppearance",
  "dashboard.onlineStore.createImageUpload",
  "dashboard.onlineStore.completeImageUpload",
  "dashboard.onlineStore.uploadImage",
  "dashboard.search.global",
  "dashboard.analytics.getDashboardStats",
  "dashboard.analytics.getRevenueReport",
  "dashboard.analytics.getProductPerformance",
  "dashboard.settings.get",
  "dashboard.settings.updateStoreInfo",
  "dashboard.settings.updateCompany",
  "dashboard.settings.updateLegal",
  "dashboard.settings.updateReservationRules",
  "dashboard.settings.updateBusinessHours",
  "dashboard.settings.updateDelivery",
  "dashboard.settings.createLocation",
  "dashboard.settings.updateLocation",
  "dashboard.settings.setLocationActive",
  "dashboard.settings.updateTaxes",
  "dashboard.settings.getLegalProfile",
  "dashboard.settings.searchCompanyRegistry",
  "dashboard.settings.upsertLegalProfile",
  "dashboard.account.getProfile",
  "dashboard.stores.list",
  "dashboard.stores.checkSlugAvailability",
  "dashboard.stores.create",
  "dashboard.stores.getLaunchChecklist",
  "dashboard.stores.completeOnboarding",
  "dashboard.inbox.list",
  "dashboard.inbox.acknowledge",
  "dashboard.payments.startStripeOnboarding",
  "dashboard.payments.openStripeDashboard",
  "dashboard.payments.syncStripeStatus",
  "dashboard.billing.getStatus",
  "dashboard.billing.startCardSetup",
  "dashboard.handoffs.get",
  "dashboard.handoffs.refresh",
  "dashboard.jobs.get",
  "dashboard.team.listMembers",
  "dashboard.team.listInvitations",
  "dashboard.team.invite",
  "dashboard.team.cancelInvitation",
  "dashboard.team.removeMember",
];

/** Arguments the MCP bridge adds to a tool and maps onto headers. */
export const BRIDGE_ARGUMENTS = ["idempotencyKey", "confirmationToken", "storeId"] as const;

/** A served procedure has a scope, or is an account procedure (`meta.account`), whose scope is optional. */
export type ExposedMeta = ApiMeta & { scope?: ProcedureScope; mcp: McpExposure };

/** One procedure the OpenAPI and MCP transports serve. */
export interface ExposedProcedure {
  /** Router path, e.g. `dashboard.categories.create`. */
  path: string;
  procedure: AnyProcedure;
  meta: ExposedMeta;
  /** JSON Schema of the input, as a caller sends it. Always an object. */
  inputJsonSchema: Record<string, unknown>;
  /** JSON Schema of the output, as the caller receives it. Always an object. */
  outputJsonSchema: Record<string, unknown>;
}

/** What the transports serve: the list, and the same procedures as a router. */
export interface Exposure {
  procedures: readonly ExposedProcedure[];
  /** Only the exposed procedures, at their paths, with their OpenAPI documentation. */
  router: AnyRouter;
}

const jsonSchemaConverter = new ZodToJsonSchemaConverter();

/**
 * A schema as JSON: the converter leaves keys it has no value for (`title`,
 * `examples`) set to undefined, which a JSON value may not hold. A `const` or
 * an `enum` (from z.literal) gets the `type` its values have, which the
 * converter leaves out and the Claude directory asks for on every parameter.
 */
export function asJson(schema: unknown): Record<string, unknown> {
  return withValueTypes(JSON.parse(JSON.stringify(schema))) as Record<string, unknown>;
}

function jsonTypeOf(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return typeof value;
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

/** Keywords whose value is data, not a schema: left as it is. */
const LITERAL_KEYWORDS = new Set(["const", "enum", "default", "examples", "example"]);
/** Keywords whose value maps names to schemas: each schema is walked, a name never read as a keyword. */
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

function withValueTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withValueTypes);
  if (!node || typeof node !== "object") return node;
  const schema: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (LITERAL_KEYWORDS.has(key)) schema[key] = value;
    else if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === "object") {
      schema[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, withValueTypes(child)]),
      );
    } else schema[key] = withValueTypes(value);
  }
  if (schema.type === undefined) {
    const values =
      "const" in schema ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : [];
    const types = new Set(values.map(jsonTypeOf));
    const [type] = types;
    if (types.size === 1 && type) schema.type = type;
  }
  return schema;
}

function lookup(router: AnyRouter, path: string): unknown {
  let node: unknown = router;
  for (const segment of path.split(".")) {
    if (!node || typeof node !== "object" || isProcedure(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function isExposure(mcp: ApiMeta["mcp"]): mcp is McpExposure {
  return Boolean(mcp && "name" in mcp);
}

/** What the Claude and ChatGPT directories check on every tool. */
function toolProblems(path: string, meta: ApiMeta, mcp: McpExposure): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(mcp.name) || mcp.name.length > MCP_TOOL_NAME_MAX) {
    problems.push(
      `${path}: tool name ${mcp.name} is not snake_case of ${MCP_TOOL_NAME_MAX} characters at most`,
    );
  }
  if (!mcp.title?.trim()) problems.push(`${path}: no meta.mcp.title`);
  if (!mcp.description?.trim()) problems.push(`${path}: no meta.mcp.description`);
  // The hints come from what the tool says it does (mcpToolAnnotations).
  const writes = meta.scope?.level === "write";
  if (writes && !mcp.effect) problems.push(`${path}: a write declares meta.mcp.effect`);
  if (!writes && mcp.effect) problems.push(`${path}: a read has no meta.mcp.effect`);
  if (meta.sensitive === "send" && mcp.reach !== "customer") {
    problems.push(`${path}: a write that sends to a customer has meta.mcp.reach "customer"`);
  }
  if (mcp.profile && meta.scope?.level === "write") {
    problems.push(`${path}: a profile tool only reads`);
  }
  return problems;
}

/**
 * Why a listed path may not be served; empty when it may. A served procedure
 * has a scope (or is an account procedure), an input and an output schema, an
 * MCP exposure (not an exclusion), takes and returns an object, and is not
 * reserved to a session or to platform staff.
 */
function problemsOf(path: string, node: unknown): string[] {
  if (!isProcedure(node)) return [`${path}: no procedure at this path`];
  const def = node["~orpc"];
  const meta = def.meta as ApiMeta;
  const problems: string[] = [];
  if (!meta.scope && !meta.account) problems.push(`${path}: no meta.scope`);
  if (!def.inputSchema) problems.push(`${path}: no input schema`);
  if (!def.outputSchema) problems.push(`${path}: no output schema`);
  if (!meta.mcp) problems.push(`${path}: no meta.mcp`);
  else if (!isExposure(meta.mcp))
    problems.push(`${path}: meta.mcp excludes it (${meta.mcp.exclude})`);
  else problems.push(...toolProblems(path, meta, meta.mcp));
  if (meta.actors && !meta.actors.includes("api_key") && !meta.actors.includes("oauth")) {
    problems.push(`${path}: only a session may call it`);
  }
  if (meta.platformAdmin) problems.push(`${path}: reserved to platform staff`);
  if (def.inputSchema) {
    const [, schema] = jsonSchemaConverter.convert(def.inputSchema, { strategy: "input" });
    if (schema.type !== "object") problems.push(`${path}: its input is not an object`);
    for (const name of BRIDGE_ARGUMENTS) {
      if (schema.properties && name in schema.properties) {
        problems.push(`${path}: its input uses ${name}, which the MCP bridge adds`);
      }
    }
  }
  if (def.outputSchema) {
    // MCP structured content is an object: a list is `{ items, nextCursor }`.
    const [, schema] = jsonSchemaConverter.convert(def.outputSchema, { strategy: "output" });
    if (schema.type !== "object") problems.push(`${path}: its output is not an object`);
  }
  return problems;
}

/** A reusable response of the document (`components.responses` in platform/openapi.ts). */
const responseRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

/**
 * What a write and a sensitive procedure take on top of their input: the
 * idempotency and confirmation headers, and the receipt headers of the
 * answer. A write whose output is never stored (`meta.secretOutput`: a
 * temporary link) ignores an idempotency key and never replays, so it
 * documents neither the key nor `Louez-Replayed`. Every operation documents
 * the error body: the statuses any call may meet (400, 401, 429; 403 where
 * a scope is checked; 412 where a confirmation may be asked; 415 where it
 * takes a body, every method but GET), and `default` for the others.
 */
function documented(
  meta: ExposedMeta,
  operation: OpenAPI.OperationObject,
  options: { ownOperationId: boolean; takesBody: boolean },
): OpenAPI.OperationObject {
  const parameters = [...(operation.parameters ?? [])];
  const isWrite = meta.scope?.level === "write";
  const replays = isWrite && !meta.secretOutput;
  if (replays) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  if (meta.sensitive) parameters.push({ $ref: "#/components/parameters/LouezConfirmation" });

  const responses: OpenAPI.ResponsesObject = { ...operation.responses };
  const success = responses["200"];
  if (isWrite && success && !("$ref" in success)) {
    responses["200"] = {
      ...success,
      headers: {
        ...success.headers,
        "Louez-Operation-Id": { $ref: "#/components/headers/LouezOperationId" },
        ...(replays ? { "Louez-Replayed": { $ref: "#/components/headers/LouezReplayed" } } : {}),
      },
    };
  }
  responses["400"] = responseRef("BadRequest");
  responses["401"] = responseRef("Unauthorized");
  // A procedure without a scope (`stores_list`) refuses no connection.
  if (meta.scope) responses["403"] = responseRef("Forbidden");
  if (meta.sensitive) responses["412"] = responseRef("ConfirmationRequired");
  if (options.takesBody) responses["415"] = responseRef("UnsupportedMediaType");
  responses["429"] = responseRef("RateLimited");
  responses.default = responseRef("Error");

  return {
    ...operation,
    // The tool name, unless the procedure names its operation: stable for SDKs.
    operationId: options.ownOperationId ? operation.operationId : meta.mcp.name,
    summary: operation.summary ?? meta.mcp.title,
    description: operation.description ?? meta.mcp.description,
    tags: operation.tags ?? [meta.scope?.domain ?? "account"],
    parameters,
    responses,
  };
}

/** The same procedure, with its OpenAPI operation documented from its meta. */
function withDocumentation(procedure: AnyProcedure, meta: ExposedMeta): AnyProcedure {
  const def = procedure["~orpc"];
  const spec = def.route.spec;
  // A procedure that writes its own whole operation keeps it.
  if (spec !== undefined && typeof spec !== "function") return procedure;
  return new Procedure({
    ...def,
    route: {
      ...def.route,
      spec: (operation: OpenAPI.OperationObject) =>
        documented(meta, typeof spec === "function" ? spec(operation) : operation, {
          ownOperationId: def.route.operationId !== undefined,
          // oRPC reads a GET's input from the query string only.
          takesBody: (def.route.method ?? "POST") !== "GET",
        }),
    },
  });
}

/**
 * Builds what the OpenAPI and MCP transports serve from `router`: only the
 * listed paths. Throws when a listed path breaks a rule (see `problemsOf`), or
 * when two procedures share a path or a tool name.
 *
 * Tests build one from a fixture router with their own list.
 */
export function createExposure(
  router: AnyRouter,
  paths: readonly string[] = EXPOSED_PROCEDURES,
): Exposure {
  const problems: string[] = [];
  const procedures: ExposedProcedure[] = [];
  const names = new Set<string>();
  const seen = new Set<string>();

  for (const path of paths) {
    if (seen.has(path)) problems.push(`${path}: listed twice`);
    seen.add(path);
    const node = lookup(router, path);
    const found = problemsOf(path, node);
    if (found.length > 0 || !isProcedure(node)) {
      problems.push(...found);
      continue;
    }
    const meta = node["~orpc"].meta as ExposedMeta;
    if (names.has(meta.mcp.name)) problems.push(`${path}: tool name ${meta.mcp.name} is taken`);
    names.add(meta.mcp.name);
    const [, inputJsonSchema] = jsonSchemaConverter.convert(node["~orpc"].inputSchema, {
      strategy: "input",
    });
    const [, outputJsonSchema] = jsonSchemaConverter.convert(node["~orpc"].outputSchema, {
      strategy: "output",
    });
    procedures.push({
      path,
      procedure: withDocumentation(node, meta),
      meta,
      inputJsonSchema: asJson(inputJsonSchema),
      outputJsonSchema: asJson(outputJsonSchema),
    });
  }
  if (problems.length > 0) {
    throw new Error(
      `The exposure registry lists procedures it may not serve:\n${problems.join("\n")}`,
    );
  }

  const served: Record<string, unknown> = {};
  for (const { path, procedure } of procedures) {
    const segments = path.split(".");
    let node = served;
    for (const segment of segments.slice(0, -1)) {
      node[segment] ??= {};
      node = node[segment] as Record<string, unknown>;
    }
    node[segments[segments.length - 1]] = procedure;
  }
  return { procedures, router: served as AnyRouter };
}

/**
 * The bundles that hold a tool `tools/list` can show: a store procedure. An
 * account tool is listed whatever the bundles, so it makes no bundle worth
 * offering. A bundle without one
 * is offered nowhere (the consent page, the connection editor, the server's
 * instructions) and comes back once a procedure of it is exposed.
 */
export function bundlesWithTools(procedures: readonly ExposedProcedure[]): McpBundle[] {
  const held = new Set(
    procedures.filter(({ meta }) => !meta.account).map(({ meta }) => meta.mcp.bundle),
  );
  return MCP_BUNDLES.filter((bundle) => held.has(bundle));
}
