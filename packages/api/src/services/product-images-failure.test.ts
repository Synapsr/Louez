import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import type { ServerErrorContext } from "../platform/error-reporting";
import type { ApiPorts } from "../platform/ports";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}
// The database is never reached: the job's own reads and writes are stubbed.
process.env.DATABASE_URL ??= "mysql://unused:unused@127.0.0.1:1/unused";

// A job failure the database did not record is unexpected: it reaches error
// tracking, and the run keeps its file (nothing says the failure is written).

const job = {
  id: "job_1",
  storeId: "store_1",
  targetId: "product_1",
  attempts: 1,
  input: {
    operation: "enhance",
    sourceUrl: "https://s/x.png",
    sourceVersionId: "v1",
    priceMicro: 1,
  },
};
const outcomes: Array<() => Promise<boolean>> = [];
const jobs = await import("../platform/jobs");
mock.module("../platform/jobs", {
  namedExports: {
    ...jobs,
    claimJob: async () => ({ kind: "claimed", job, token: "t", grantedAt: 0 }),
    recordJobFailure: () => (outcomes.shift() ?? (async () => true))(),
  },
});
const { runImageJob } = await import("./product-images");

function portsReporting(reported: Array<[unknown, ServerErrorContext]>): ApiPorts {
  const reportError = (error: unknown, context: ServerErrorContext) => {
    reported.push([error, context]);
  };
  // No AI photo port: the job fails at once, through `fail`.
  return { reportError } as unknown as ApiPorts;
}

describe("an image job whose failure is not recorded", () => {
  test("a database error is reported, with the store and the operation", async () => {
    const reported: Array<[unknown, ServerErrorContext]> = [];
    const down = new Error("Connection lost: The server closed the connection.");
    outcomes.push(async () => {
      throw down;
    });
    await runImageJob("job_1", portsReporting(reported));
    assert.deepEqual(reported, [[down, { source: "job", job: "enhance", storeId: "store_1" }]]);
  });

  test("a claim taken over is no fault: nothing is reported", async () => {
    const reported: Array<[unknown, ServerErrorContext]> = [];
    outcomes.push(async () => false);
    await runImageJob("job_1", portsReporting(reported));
    assert.deepEqual(reported, []);
  });
});
