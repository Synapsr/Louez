import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { relativeFramePath, relativeSourcePath } from "./source-paths";

// Frames name the repository's paths, never the machine's directories.

describe("source paths", () => {
  test("an absolute path becomes relative to the repository", () => {
    assert.equal(
      relativeFramePath(
        "at listInbox (/Users/someone/Developer/Louez/packages/api/src/services/inbox.ts:12:3)",
      ),
      "at listInbox (packages/api/src/services/inbox.ts:12:3)",
    );
    assert.equal(
      relativeFramePath("    at /app/apps/web/.next/server/chunks/123.js:1:4567"),
      "    at apps/web/.next/server/chunks/123.js:1:4567",
    );
    assert.equal(
      relativeFramePath("at run (file:///home/deploy/app/node_modules/mysql2/lib/conn.js:9:1)"),
      "at run (node_modules/mysql2/lib/conn.js:9:1)",
    );
  });

  test("a path outside the repository keeps only its file name", () => {
    assert.equal(relativeSourcePath("/Users/someone/tmp/script.js"), "script.js");
    assert.equal(relativeSourcePath("C:\\Users\\someone\\Louez\\apps\\web\\a.ts"), "apps/web/a.ts");
    assert.equal(
      relativeFramePath("at Object.<anonymous> (/Users/someone/tmp/script.js:1:1)"),
      "at Object.<anonymous> (script.js:1:1)",
    );
  });

  test("a relative path and Node's own frames stay", () => {
    assert.equal(relativeSourcePath("apps/web/a.ts"), "apps/web/a.ts");
    const frame = "at process.processTicksAndRejections (node:internal/process/task_queues:105:5)";
    assert.equal(relativeFramePath(frame), frame);
  });
});
