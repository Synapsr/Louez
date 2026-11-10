import type { ClientWithholding } from "./agent-clients";
import { createExposure, type ExposedMeta, type ExposedProcedure } from "./exposure";

let appProcedures: Promise<readonly ExposedProcedure[]> | undefined;

/**
 * Whether `withheld` forbids a procedure: by its capability, or by its scope
 * when every domain that opens it is withheld (`handoffs.refresh` opens on
 * billing or settings, so it stays with settings).
 */
function forbids(withheld: ClientWithholding, meta: ExposedMeta): boolean {
  if (meta.capability && withheld.capabilities.includes(meta.capability)) return true;
  if (!meta.scope) return false;
  return [meta.scope.domain, ...(meta.scope.anyOf ?? [])].every((domain) =>
    withheld.domains.includes(domain),
  );
}

/**
 * The router paths (`dashboard.products.enhanceImage`) of the procedures a
 * client's directory forbids, as `api_operations.procedure` names them. Read
 * once from the app's exposure (the router is loaded on first use, as it
 * imports the callers): only an exposed procedure is called by an agent.
 */
export async function withheldProcedurePaths(
  withheld: ClientWithholding | undefined,
): Promise<string[]> {
  if (!withheld || (withheld.capabilities.length === 0 && withheld.domains.length === 0)) {
    return [];
  }
  appProcedures ??= import("../router").then(
    ({ appRouter }) => createExposure(appRouter).procedures,
  );
  return (await appProcedures)
    .filter(({ meta }) => forbids(withheld, meta))
    .map(({ path }) => path);
}
