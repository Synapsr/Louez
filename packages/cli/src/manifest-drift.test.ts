import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MANIFEST_PATH, generatedManifestModule } from "../scripts/generate-manifest.js";

// The committed manifest is the API's: an operation added, removed or
// changed in @louez/api without `pnpm --filter ./packages/cli generate`
// fails here, in CI's "Tests (others)" job.
test("the committed manifest is the one the API's OpenAPI document generates", async () => {
  const committed = readFileSync(MANIFEST_PATH, "utf8");
  const current = await generatedManifestModule();
  if (committed === current) return;

  const ids = (text: string) =>
    new Set([...text.matchAll(/^ {6}"id": "([^"]+)",$/gm)].map((match) => match[1]!));
  const before = ids(committed);
  const after = ids(current);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  assert.fail(
    `src/manifest.generated.ts is out of date with the API${added.length > 0 ? `; added: ${added.join(", ")}` : ""}${removed.length > 0 ? `; removed: ${removed.join(", ")}` : ""}. Run \`pnpm --filter ./packages/cli generate\` and commit the result.`,
  );
});
