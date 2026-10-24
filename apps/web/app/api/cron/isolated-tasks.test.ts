import assert from "node:assert/strict";
import { test } from "node:test";

import { runIsolatedTasks, type IsolatedTaskLogs } from "./isolated-tasks";

test("a failed task is logged on its own and the next tasks still run", async () => {
  const requestErrors: { message: string; context: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];
  const logs: IsolatedTaskLogs = {
    request: { error: (error, context) => requestErrors.push({ message: error.message, context }) },
    event: { error: (event) => events.push(event) },
  };
  const reportError = new Error("report failed");
  const ran: string[] = [];

  const { tasks, results } = await runIsolatedTasks(
    [
      {
        task: "report",
        key: "report",
        run: async () => {
          ran.push("report");
          throw reportError;
        },
      },
      {
        task: "check",
        key: "check",
        run: async () => {
          ran.push("check");
          return { missing: 0 };
        },
      },
      {
        task: "other",
        key: "other",
        run: () => {
          ran.push("other");
          return Promise.reject("not an error");
        },
      },
    ],
    logs,
  );

  assert.deepEqual(ran, ["report", "check", "other"]);
  assert.deepEqual(tasks, ["report", "check", "other"]);
  assert.deepEqual(results, {
    report: { failed: true },
    check: { missing: 0 },
    other: { failed: true },
  });
  assert.deepEqual(requestErrors, [
    { message: "report failed", context: { cron: { failedTasks: ["report"] } } },
    { message: "not an error", context: { cron: { failedTasks: ["other"] } } },
  ]);

  // Each failure has its own event, with its own message and stack.
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    cron: {
      event: "task_failed",
      task: "report",
      error: { name: "Error", message: "report failed", stack: reportError.stack },
    },
  });
  assert.match(
    JSON.stringify(events[1]),
    /^\{"cron":\{"event":"task_failed","task":"other","error":\{"name":"Error","message":"not an error","stack":"Error: not an error\\n/,
  );
});
