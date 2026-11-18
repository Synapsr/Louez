import type { PostHog } from "posthog-js";

/**
 * Links the dashboard's OpenReplay session and the PostHog person both ways:
 * PostHog keeps the replay URL (person properties and a super property), and
 * OpenReplay keeps the PostHog distinct id as session metadata.
 */

/** The OpenReplay metadata key; it must be declared in the project's Metadata settings. */
export const openReplayPostHogDistinctIdKey = "posthogDistinctId";

export const openReplaySessionUrlProperties = {
  event: "openreplay_session_url",
  lastSession: "openreplay_last_session_url",
  firstSession: "openreplay_first_session_url",
} as const;

type PostHogLinkClient = Pick<
  PostHog,
  "__loaded" | "has_opted_out_capturing" | "get_distinct_id" | "register" | "setPersonProperties"
>;

type OpenReplayLinkTracker = {
  getSessionURL: () => string | undefined;
  setMetadata: (key: string, value: string) => void;
};

/** What PostHog keeps for a session: the super property and the person properties. */
export const buildOpenReplaySessionProperties = (sessionUrl: string) => ({
  superProperties: { [openReplaySessionUrlProperties.event]: sessionUrl },
  set: { [openReplaySessionUrlProperties.lastSession]: sessionUrl },
  setOnce: { [openReplaySessionUrlProperties.firstSession]: sessionUrl },
});

/**
 * Returns a linker that sends each (person, session) pair once. It sends
 * nothing while PostHog is not loaded or the visitor opted out of capturing,
 * and nothing before OpenReplay has a session.
 */
export const createOpenReplayPostHogLinker = () => {
  let linkedKey: string | undefined;

  return ({ posthog, tracker }: { posthog: PostHogLinkClient; tracker: OpenReplayLinkTracker }) => {
    if (!posthog.__loaded || posthog.has_opted_out_capturing()) {
      return false;
    }

    const sessionUrl = tracker.getSessionURL();
    const distinctId = posthog.get_distinct_id();

    if (!sessionUrl || !distinctId) {
      return false;
    }

    const key = `${distinctId}\n${sessionUrl}`;
    if (key === linkedKey) {
      return false;
    }

    const { superProperties, set, setOnce } = buildOpenReplaySessionProperties(sessionUrl);
    posthog.register(superProperties);
    posthog.setPersonProperties(set, setOnce);
    tracker.setMetadata(openReplayPostHogDistinctIdKey, distinctId);
    linkedKey = key;

    return true;
  };
};

export const linkOpenReplaySessionToPostHog = createOpenReplayPostHogLinker();
