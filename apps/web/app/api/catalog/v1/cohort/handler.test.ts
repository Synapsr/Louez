import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCatalogCohortGet } from "./handler";

test("rejects an unsigned cohort request before reading cohort state", async () => {
  let cohortReads = 0;
  const response = await handleCatalogCohortGet({
    request: new Request("https://louez.example/api/catalog/v1/cohort"),
    secret: "catalog-secret",
    getCohortStatus: async () => {
      cohortReads += 1;
      return { taken: 1, total: 1_000, remaining: 999 };
    },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(cohortReads, 0);
});
