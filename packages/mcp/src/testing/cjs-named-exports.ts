/**
 * Test preload (`node --import`). @louez/types, @louez/utils and
 * @louez/validations are CommonJS under tsx, and Node's ESM loader cannot see
 * their re-exported names, so an ES module importing `{ hasPermission }` from
 * them fails to link. This hands the loader their real exports by name, as
 * packages/api's tests do.
 */
import { createRequire } from "node:module";
import { mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved as @louez/api sees them: this package does not depend on all of them.
const fromApi = createRequire(fileURLToPath(import.meta.resolve("@louez/api/platform/actor")));

/** The URL a test mocks to replace a package @louez/api imports. */
export function apiDependencyUrl(name: string): string {
  return pathToFileURL(fromApi.resolve(name)).href;
}

for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = fromApi(name);
  mock.module(apiDependencyUrl(name), { namedExports });
}
