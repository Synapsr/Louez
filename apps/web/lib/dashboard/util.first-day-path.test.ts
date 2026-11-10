import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDayAgenda } from "./util.day-agenda";
import { getFirstDayPath } from "./util.first-day-path";
import { getHomeTip } from "./util.home-tip";
import { getOverdueSummary } from "./util.overdue-summary";
import { getPaymentsSetupState, shouldShowRequestsCard } from "./util.payments-setup";

const firstDay = {
  activeProductCount: 0,
  onlinePaymentsStep: "hidden" as const,
  paymentsSetup: null,
  isFromReeent: false,
};

test("a store on request mode has its payments step done, and can still switch", () => {
  const path = getFirstDayPath(firstDay);

  assert.deepEqual(
    path.steps.map((step) => `${step.key}:${step.state}`),
    ["product:current", "payments:done", "share:upcoming"],
  );
  assert.equal(path.paymentsMode, "request");
  assert.equal(path.completedCount, 1);
  assert.equal(getFirstDayPath({ ...firstDay, activeProductCount: 1 }).current, "share");
});

test("a store that chose Stripe gets it as step 2, and moves on while Stripe checks", () => {
  const online = {
    ...firstDay,
    onlinePaymentsStep: "todo" as const,
    paymentsSetup: "start" as const,
  };

  assert.deepEqual(
    getFirstDayPath({ ...online, activeProductCount: 1 }).steps.map(
      (step) => `${step.key}:${step.state}`,
    ),
    ["product:done", "payments:current", "share:upcoming"],
  );
  assert.deepEqual(
    getFirstDayPath({ ...online, activeProductCount: 1, paymentsSetup: "verifying" }).steps.map(
      (step) => `${step.key}:${step.state}`,
    ),
    ["product:done", "payments:waiting", "share:current"],
  );
  assert.equal(
    getFirstDayPath({
      ...online,
      onlinePaymentsStep: "done",
      paymentsSetup: null,
      activeProductCount: 1,
    }).completedCount,
    2,
  );
});

test("a reeent store activates Stripe first and has nothing to share", () => {
  const reeent = {
    ...firstDay,
    isFromReeent: true,
    onlinePaymentsStep: "todo" as const,
    paymentsSetup: "start" as const,
  };

  assert.deepEqual(
    getFirstDayPath(reeent).steps.map((step) => step.key),
    ["payments", "product"],
  );
  assert.equal(
    getFirstDayPath({
      ...reeent,
      onlinePaymentsStep: "done",
      paymentsSetup: null,
      activeProductCount: 1,
    }).current,
    null,
  );
});

test("an unfinished payment setup reads as start, resume or verifying", () => {
  const todo = { onlinePaymentsStep: "todo" as const, stripeOnboardingComplete: null };

  assert.equal(getPaymentsSetupState({ ...todo, stripeAccountId: null }), "start");
  assert.equal(getPaymentsSetupState({ ...todo, stripeAccountId: "acct_1" }), "resume");
  assert.equal(
    getPaymentsSetupState({ ...todo, stripeAccountId: "acct_1", stripeOnboardingComplete: true }),
    "verifying",
  );
  assert.equal(
    getPaymentsSetupState({
      onlinePaymentsStep: "hidden",
      stripeAccountId: null,
      stripeOnboardingComplete: null,
    }),
    null,
  );
});

test("the requests card stays off a store paid online that has nothing waiting", () => {
  const base = { paysOnline: true, actionablePendingCount: 0, hasFirstDayPath: false };

  assert.equal(shouldShowRequestsCard(base), false);
  assert.equal(shouldShowRequestsCard({ ...base, paysOnline: false }), true);
  assert.equal(shouldShowRequestsCard({ ...base, actionablePendingCount: 1 }), true);
  assert.equal(shouldShowRequestsCard({ ...base, hasFirstDayPath: true }), true);
});

test("the agenda merges both directions in time order and marks where now falls", () => {
  const at = (iso: string) => ({ startDate: new Date(iso), endDate: new Date(iso) });
  const agenda = buildDayAgenda({
    departures: [at("2026-11-10T08:00:00Z"), at("2026-11-10T09:15:00Z")],
    returns: [at("2026-11-10T08:00:00Z"), at("2026-11-10T16:00:00Z")],
    now: new Date("2026-11-10T09:00:00Z"),
  });

  assert.deepEqual(
    agenda.entries.map((entry) => entry.kind),
    ["return", "departure", "departure", "return"],
  );
  assert.equal(agenda.nowIndex, 2);
  assert.equal(
    buildDayAgenda({
      departures: [],
      returns: [at("2026-11-10T08:00:00Z")],
      now: new Date("2026-11-10T20:00:00Z"),
    }).nowIndex,
    1,
  );
});

test("overdue reservations get rows up to two, then one line per kind", () => {
  const rows = [
    { overdueKind: "return" as const, dueAt: new Date("2026-11-01T10:00:00Z") },
    { overdueKind: "departure" as const, dueAt: new Date("2026-11-05T10:00:00Z") },
  ];

  assert.equal(
    getOverdueSummary({ rows, overdueReturns: 1, overdueDepartures: 1 }).display,
    "rows",
  );
  assert.equal(
    getOverdueSummary({ rows, overdueReturns: 2, overdueDepartures: 1 }).display,
    "grouped",
  );
  const grouped = getOverdueSummary({ rows, overdueReturns: 14, overdueDepartures: 6 });
  assert.equal(grouped.display, "grouped");
  assert.equal(grouped.total, 20);
  assert.equal(grouped.returns.oldestDueAt?.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(grouped.departures.count, 6);
});

test("tips come one at a time: Stripe for a store paid on site, then the starting tips", () => {
  const input = {
    dismissed: [],
    paysOnSite: true,
    hasFirstDayPath: false,
    isStartingAndUpToDate: true,
    reviewBoosterAvailable: true,
    reviewBoosterEnabled: false,
  };

  assert.equal(getHomeTip(input), "onlinePayments");
  assert.equal(getHomeTip({ ...input, hasFirstDayPath: true }), "manualReservation");
  assert.equal(
    getHomeTip({ ...input, dismissed: ["home-tip-online-payments"] }),
    "manualReservation",
  );
  assert.equal(
    getHomeTip({
      ...input,
      dismissed: ["home-tip-online-payments", "home-tip-manual-reservation"],
    }),
    "reviewBooster",
  );
  assert.equal(getHomeTip({ ...input, paysOnSite: false, isStartingAndUpToDate: false }), null);
});
