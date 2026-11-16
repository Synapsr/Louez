/**
 * The OpenAPI document `/api/v1/openapi.json` serves, generated from
 * @louez/api's exposed router as the route generates it, without a server
 * or a database. Run with `--import tsx --experimental-test-module-mocks`.
 */
import { createRequire } from "node:module";
import { mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { OpenApiDocument } from "../src/manifest-builder.js";

// Before anything loads: the packages read their environment as they load,
// and the router's @louez/auth reads the database URL. Nothing connects.
process.env.DATABASE_URL ??= "mysql://unused:unused@127.0.0.1:1/unused";
process.env.SKIP_ENV_VALIDATION ??= "true";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot
// see: hand the loader their real exports, resolved as @louez/api sees them.
const fromApi = createRequire(fileURLToPath(import.meta.resolve("@louez/api/platform/openapi")));
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  mock.module(pathToFileURL(fromApi.resolve(name)).href, { namedExports: fromApi(name) });
}

/**
 * The API's modules, imported by a name TypeScript does not follow: this
 * package type-checks alone, under its own settings, and only these three
 * calls cross into @louez/api.
 */
const apiModule = (name: string): Promise<Record<string, unknown>> => import(`@louez/api/${name}`);

interface ApiModules {
  createExposure(router: unknown): { router: unknown };
  generateOpenApiDocument(router: unknown): Promise<unknown>;
  appRouter: unknown;
}

export async function loadApiDocument(): Promise<OpenApiDocument> {
  const [exposure, openapi, router] = await Promise.all([
    apiModule("platform/exposure"),
    apiModule("platform/openapi"),
    apiModule("router"),
  ]);
  const { createExposure, generateOpenApiDocument, appRouter } = {
    ...exposure,
    ...openapi,
    ...router,
  } as unknown as ApiModules;
  return (await generateOpenApiDocument(createExposure(appRouter).router)) as OpenApiDocument;
}
