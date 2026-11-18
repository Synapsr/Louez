import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildOpenReplaySessionProperties,
  createOpenReplayPostHogLinker,
  openReplayPostHogDistinctIdKey,
} from "./posthog-link";

// The dashboard's replay and its PostHog person point at each other, sent once
// per person and session, and never past PostHog's opt-out.

const sessionUrl = "https://replay.example.com/3/session/7311";

type FakeOptions = {
  loaded?: boolean;
  optedOut?: boolean;
  distinctId?: string;
  /** `null`: OpenReplay has no session yet. */
  url?: string | null;
};

type FakeCalls = {
  register: unknown[];
  setPersonProperties: unknown[][];
  setMetadata: unknown[][];
};

const createFakes = ({
  loaded = true,
  optedOut = false,
  distinctId = "user_1",
  url = sessionUrl,
}: FakeOptions = {}) => {
  const calls: FakeCalls = { register: [], setPersonProperties: [], setMetadata: [] };
  const state = { distinctId, url };

  const posthog = {
    __loaded: loaded,
    has_opted_out_capturing: () => optedOut,
    get_distinct_id: () => state.distinctId,
    register: (properties: Record<string, unknown>) => {
      calls.register.push(properties);
    },
    setPersonProperties: (set?: Record<string, unknown>, setOnce?: Record<string, unknown>) => {
      calls.setPersonProperties.push([set, setOnce]);
    },
  };
  const tracker = {
    getSessionURL: () => state.url ?? undefined,
    setMetadata: (key: string, value: string) => {
      calls.setMetadata.push([key, value]);
    },
  };

  return { posthog, tracker, calls, state };
};

describe("OpenReplay session properties", () => {
  test("the last session is overwritten, the first one is kept", () => {
    assert.deepEqual(buildOpenReplaySessionProperties(sessionUrl), {
      superProperties: { openreplay_session_url: sessionUrl },
      set: { openreplay_last_session_url: sessionUrl },
      setOnce: { openreplay_first_session_url: sessionUrl },
    });
  });
});

describe("linking OpenReplay and PostHog", () => {
  test("sends the replay URL to PostHog and the distinct id to OpenReplay", () => {
    const link = createOpenReplayPostHogLinker();
    const { posthog, tracker, calls } = createFakes();

    assert.equal(link({ posthog, tracker }), true);
    assert.deepEqual(calls.register, [{ openreplay_session_url: sessionUrl }]);
    assert.deepEqual(calls.setPersonProperties, [
      [{ openreplay_last_session_url: sessionUrl }, { openreplay_first_session_url: sessionUrl }],
    ]);
    assert.deepEqual(calls.setMetadata, [[openReplayPostHogDistinctIdKey, "user_1"]]);
  });

  test("sends a pair once, and again when the session or the person changes", () => {
    const link = createOpenReplayPostHogLinker();
    const { posthog, tracker, calls, state } = createFakes();

    link({ posthog, tracker });
    assert.equal(link({ posthog, tracker }), false);
    assert.equal(calls.setPersonProperties.length, 1);

    state.url = "https://replay.example.com/3/session/7312";
    assert.equal(link({ posthog, tracker }), true);

    state.distinctId = "user_2";
    assert.equal(link({ posthog, tracker }), true);

    assert.equal(calls.setPersonProperties.length, 3);
    assert.deepEqual(calls.setMetadata.at(-1), [openReplayPostHogDistinctIdKey, "user_2"]);
  });

  test("sends nothing while PostHog is not loaded or the visitor opted out", () => {
    for (const fakes of [createFakes({ loaded: false }), createFakes({ optedOut: true })]) {
      const link = createOpenReplayPostHogLinker();

      assert.equal(link(fakes), false);
      assert.deepEqual(fakes.calls, { register: [], setPersonProperties: [], setMetadata: [] });
    }
  });

  test("sends nothing before OpenReplay has a session", () => {
    const link = createOpenReplayPostHogLinker();
    const fakes = createFakes({ url: null });

    assert.equal(link(fakes), false);
    assert.deepEqual(fakes.calls, { register: [], setPersonProperties: [], setMetadata: [] });
  });
});
