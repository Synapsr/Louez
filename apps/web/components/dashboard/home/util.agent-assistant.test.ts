import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldOfferAgentAssistant } from "./util.agent-assistant";

test("the home offers an assistant to a store without one", () => {
  assert.equal(
    shouldOfferAgentAssistant({ dismissedNoticeIds: [], hasAgentConnection: false }),
    true,
  );
});

test("a closed offer stays closed", () => {
  assert.equal(
    shouldOfferAgentAssistant({
      dismissedNoticeIds: ["agent-assistant"],
      hasAgentConnection: false,
    }),
    false,
  );
});

test("another closed notice leaves the offer", () => {
  assert.equal(
    shouldOfferAgentAssistant({
      dismissedNoticeIds: ["reeent-cohort-seats"],
      hasAgentConnection: false,
    }),
    true,
  );
});

test("a store an agent can act on is not offered one", () => {
  assert.equal(
    shouldOfferAgentAssistant({ dismissedNoticeIds: [], hasAgentConnection: true }),
    false,
  );
});
