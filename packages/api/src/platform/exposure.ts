import type { OpenAPI } from "@orpc/contract";
import { isProcedure, Procedure, type AnyProcedure, type AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { ApiMeta, McpExposure } from "./meta";
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
  "dashboard.products.list",
  "dashboard.products.listLegacyPage",
  "dashboard.products.get",
  "dashboard.products.create",
  "dashboard.products.update",
  "dashboard.products.updateStatus",
  "dashboard.products.delete",
  "dashboard.products.duplicate",
  "dashboard.products.reorder",
  "dashboard.products.createImageUpload",
  "dashboard.products.completeImageUpload",
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
  "dashboard.search.global",
  "dashboard.stores.list",
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
}

/** What the transports serve: the list, and the same procedures as a router. */
export interface Exposure {
  procedures: readonly ExposedProcedure[];
  /**
   * Only the exposed procedures, at their paths, with their OpenAPI
   * documentation; former MCP-only tools (`meta.mcp.listed: false`) left out.
   */
  router: AnyRouter;
}

const jsonSchemaConverter = new ZodToJsonSchemaConverter();

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

/**
 * What a write and a sensitive procedure take on top of their input: the
 * idempotency and confirmation headers, and the receipt headers of the answer.
 */
function documented(
  meta: ExposedMeta,
  operation: OpenAPI.OperationObject,
  ownOperationId: boolean,
): OpenAPI.OperationObject {
  const parameters = [...(operation.parameters ?? [])];
  const isWrite = meta.scope?.level === "write";
  if (isWrite && !meta.secretOutput) {
    parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  }
  if (meta.sensitive) parameters.push({ $ref: "#/components/parameters/LouezConfirmation" });

  const responses = { ...operation.responses };
  const success = responses["200"];
  if (isWrite && success && !("$ref" in success)) {
    responses["200"] = {
      ...success,
      headers: {
        ...success.headers,
        "Louez-Operation-Id": { $ref: "#/components/headers/LouezOperationId" },
        "Louez-Replayed": { $ref: "#/components/headers/LouezReplayed" },
      },
    };
  }

  return {
    ...operation,
    // The tool name, unless the procedure names its operation: stable for SDKs.
    operationId: ownOperationId ? operation.operationId : meta.mcp.name,
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
        documented(
          meta,
          typeof spec === "function" ? spec(operation) : operation,
          def.route.operationId !== undefined,
        ),
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
    for (const name of [meta.mcp.name, ...(meta.mcp.aliases ?? []).map((alias) => alias.name)]) {
      if (names.has(name)) problems.push(`${path}: tool name ${name} is taken`);
      names.add(name);
    }
    const [, inputJsonSchema] = jsonSchemaConverter.convert(node["~orpc"].inputSchema, {
      strategy: "input",
    });
    procedures.push({
      path,
      procedure: withDocumentation(node, meta),
      meta,
      inputJsonSchema: inputJsonSchema as Record<string, unknown>,
    });
  }
  if (problems.length > 0) {
    throw new Error(
      `The exposure registry lists procedures it may not serve:\n${problems.join("\n")}`,
    );
  }

  // A former tool kept for MCP agents (`meta.mcp.listed: false`) stays off OpenAPI.
  const served: Record<string, unknown> = {};
  for (const { path, procedure, meta } of procedures) {
    if (meta.mcp.listed === false) continue;
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
