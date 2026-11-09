import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Each task's function is replaced by one that names it, so the test reads
// which function each task runs without a database or the senders' modules.
const called: string[] = [];
const fake = (name: string) => async () => {
  called.push(name);
  return name;
};
mock.module("@/lib/api/effects", {
  namedExports: { runApiEffectsCron: fake("runApiEffectsCron") },
});
mock.module("@louez/api/services/inbox", {
  namedExports: { pruneInboxAcknowledgements: fake("pruneInboxAcknowledgements") },
});
mock.module("@louez/api/services/handoffs", {
  namedExports: { purgeHandoffs: fake("purgeHandoffs") },
});
mock.module("@louez/api/platform/operations", {
  namedExports: { purgeOperations: fake("purgeOperations") },
});
mock.module("@louez/auth/oauth-retention", {
  namedExports: { purgeOAuthTokens: fake("purgeOAuthTokens") },
});

test("every cron call runs the outbox, then each purge of the agent-ready API", async () => {
  const { apiTasks } = await import("./api-tasks");
  const tasks = apiTasks();
  const results = [];
  for (const { task, key, run } of tasks) results.push({ task, key, runs: await run() });
  assert.deepEqual(results, [
    { task: "api-effects", key: "apiEffects", runs: "runApiEffectsCron" },
    {
      task: "inbox-acknowledgements",
      key: "inboxAcknowledgements",
      runs: "pruneInboxAcknowledgements",
    },
    { task: "api-handoffs", key: "apiHandoffs", runs: "purgeHandoffs" },
    { task: "api-operations", key: "apiOperations", runs: "purgeOperations" },
    { task: "oauth-tokens", key: "oauthTokens", runs: "purgeOAuthTokens" },
  ]);
  assert.equal(called.length, tasks.length);
});
