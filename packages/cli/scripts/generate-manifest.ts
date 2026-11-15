/** Writes src/manifest.generated.ts from the API's current OpenAPI document. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildManifest, renderManifestModule } from "../src/manifest-builder.js";
import { loadApiDocument } from "./api-document.js";

export const MANIFEST_PATH = fileURLToPath(
  new URL("../src/manifest.generated.ts", import.meta.url),
);

export async function generatedManifestModule(): Promise<string> {
  return renderManifestModule(buildManifest(await loadApiDocument()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(MANIFEST_PATH, await generatedManifestModule());
  process.stderr.write(`Wrote ${MANIFEST_PATH}\n`);
  // The router's modules keep handles open (a database pool, timers).
  process.exit(0);
}
