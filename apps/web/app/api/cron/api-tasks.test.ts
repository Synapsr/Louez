import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

closeNetworkForSuite();

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
mock.module("@/lib/reservations/deposit-hold-debts", {
  namedExports: { runDepositReleaseDebtsCron: fake("runDepositReleaseDebtsCron") },
});
mock.module("@/lib/reservations/stripe-refund-cron", {
  namedExports: { runStaleRefundOperationsCron: fake("runStaleRefundOperationsCron") },
});
/** While set, the abandoned checkouts' pass waits on its provider for ever. */
let passHangs = false;
mock.module("@/lib/reservations/abandoned-checkouts", {
  namedExports: {
    settleAbandonedCheckouts: async () => {
      called.push("settleAbandonedCheckouts");
      if (passHangs) await new Promise(() => {});
      return "settleAbandonedCheckouts";
    },
  },
});
mock.module("@/lib/partners/partner-statements-cron", {
  namedExports: { runPartnerStatementsCron: fake("runPartnerStatementsCron") },
});
mock.module("@/lib/api/jobs", {
  namedExports: { runApiJobsCron: fake("runApiJobsCron") },
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
mock.module("@louez/api/services/uploads", {
  namedExports: { purgeStagedUploads: fake("purgeStagedUploads") },
});
mock.module("@/lib/storage/api-storage", { namedExports: { apiStorage: {} } });
mock.module("@/lib/evlog", { namedExports: { log: { error() {} } } });

/** A cron call at :12, when the hourly purge of the uploads' staging does not run. */
const AT_12 = new Date("2027-01-10T12:12:00Z");

test("every cron call requeues the deposit releases owed and the refunds still requested, queues the partners' statements, runs the outbox, each purge of the agent-ready API, its background jobs, then settles the abandoned checkouts", async () => {
  const { apiTasks } = await import("./api-tasks");
  const tasks = apiTasks(AT_12);
  const results = [];
  for (const { task, key, run } of tasks) results.push({ task, key, runs: await run() });
  assert.deepEqual(results, [
    {
      task: "deposit-release-debts",
      key: "depositReleaseDebts",
      runs: "runDepositReleaseDebtsCron",
    },
    {
      task: "stale-refund-operations",
      key: "staleRefundOperations",
      runs: "runStaleRefundOperationsCron",
    },
    {
      task: "partner-statements",
      key: "partnerStatements",
      runs: "runPartnerStatementsCron",
    },
    { task: "api-effects", key: "apiEffects", runs: "runApiEffectsCron" },
    {
      task: "inbox-acknowledgements",
      key: "inboxAcknowledgements",
      runs: "pruneInboxAcknowledgements",
    },
    { task: "api-handoffs", key: "apiHandoffs", runs: "purgeHandoffs" },
    { task: "api-operations", key: "apiOperations", runs: "purgeOperations" },
    { task: "oauth-tokens", key: "oauthTokens", runs: "purgeOAuthTokens" },
    { task: "api-jobs", key: "apiJobs", runs: "runApiJobsCron" },
    {
      task: "abandoned-checkouts",
      key: "abandonedCheckouts",
      runs: "settleAbandonedCheckouts",
    },
  ]);
  assert.equal(called.length, tasks.length);
});

test("once an hour, at :40, the purges include the image uploads left in staging, before the background jobs", async () => {
  const { apiTasks } = await import("./api-tasks");
  const names = (minute: number) =>
    apiTasks(new Date(Date.UTC(2027, 0, 10, 12, minute))).map(({ task }) => task);
  for (let minute = 0; minute < 60; minute++) {
    assert.equal(names(minute).includes("upload-staging"), minute === 40, String(minute));
  }
  const tasks = apiTasks(new Date(Date.UTC(2027, 0, 10, 12, 40)));
  const staging = tasks.find(({ task }) => task === "upload-staging");
  assert.equal(staging?.key, "uploadStaging");
  assert.equal(await staging?.run(), "purgeStagedUploads");
  assert.deepEqual(names(40).slice(names(40).indexOf("oauth-tokens"), -1), [
    "oauth-tokens",
    "upload-staging",
    "api-jobs",
  ]);
});

test("a pass over abandoned checkouts that hangs on its provider holds no other task back: each has run before it", async () => {
  const { apiTasks } = await import("./api-tasks");
  const { runIsolatedTasks } = await import("./isolated-tasks");
  called.length = 0;
  passHangs = true;
  const quiet = { error() {} };

  // Never awaited: the pass never ends.
  void runIsolatedTasks(apiTasks(AT_12), { request: quiet, event: quiet });
  while (!called.includes("settleAbandonedCheckouts")) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(called, [
    "runDepositReleaseDebtsCron",
    "runStaleRefundOperationsCron",
    "runPartnerStatementsCron",
    "runApiEffectsCron",
    "pruneInboxAcknowledgements",
    "purgeHandoffs",
    "purgeOperations",
    "purgeOAuthTokens",
    "runApiJobsCron",
    "settleAbandonedCheckouts",
  ]);
});
