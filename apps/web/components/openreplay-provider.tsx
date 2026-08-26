"use client";

import { useEffect } from "react";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { markOpenReplayReady } from "@/lib/openreplay/client";
import type { PublicEnv } from "@/lib/validators/validator.public-env";

type OpenReplayTracker = InstanceType<Awaited<typeof import("@openreplay/tracker")>["default"]>;

type OpenReplaySurface = "dashboard" | "storefront";
type OpenReplayConfig = Pick<
  PublicEnv,
  | "NEXT_PUBLIC_OPENREPLAY_INGEST_POINT"
  | "NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY"
  | "NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY"
>;

declare global {
  interface Window {
    __louezOpenReplayTracker?: OpenReplayTracker;
    __louezOpenReplayTrackerPromise?: Promise<OpenReplayTracker>;
    __louezOpenReplayProjectKey?: string;
    __louezOpenReplayStartPromise?: Promise<unknown>;
  }
}

interface OpenReplayProviderProps {
  children?: React.ReactNode;
  surface: OpenReplaySurface;
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
  store?: {
    id: string;
    name: string;
    slug?: string;
  };
}

function getSurfaceProjectKey(surface: OpenReplaySurface, config: OpenReplayConfig) {
  return surface === "dashboard"
    ? config.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY
    : config.NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY;
}

function getSurfaceTrackerOptions(surface: OpenReplaySurface) {
  if (surface === "dashboard") {
    return {
      defaultInputMode: 0,
      obscureTextEmails: false,
      obscureTextNumbers: false,
      obscureInputEmails: false,
      obscureInputNumbers: false,
      obscureInputDates: false,
    } as const;
  }

  return {
    privateMode: true,
    obscureTextEmails: true,
    obscureTextNumbers: true,
    obscureInputEmails: true,
    obscureInputNumbers: true,
    obscureInputDates: true,
  } as const;
}

async function getOpenReplayTracker(surface: OpenReplaySurface, config: OpenReplayConfig) {
  const projectKey = getSurfaceProjectKey(surface, config);
  const ingestPoint = config.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT;

  if (!projectKey || !ingestPoint) {
    return null;
  }

  if (window.__louezOpenReplayTracker && window.__louezOpenReplayProjectKey === projectKey) {
    return window.__louezOpenReplayTracker;
  }

  window.__louezOpenReplayTrackerPromise ??= (async () => {
    const { default: Tracker } = await import("@openreplay/tracker");

    window.__louezOpenReplayTracker = new Tracker({
      projectKey,
      ingestPoint,
      respectDoNotTrack: true,
      ...getSurfaceTrackerOptions(surface),
      network: {
        sessionTokenHeader: false,
        failuresOnly: false,
        capturePayload: false,
        captureInIframes: false,
        ignoreHeaders: true,
      },
    });
    window.__louezOpenReplayProjectKey = projectKey;

    return window.__louezOpenReplayTracker;
  })();

  return window.__louezOpenReplayTrackerPromise;
}

export const OpenReplayProvider = ({ children, surface, user, store }: OpenReplayProviderProps) => {
  const publicEnv = usePublicEnv();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    void getOpenReplayTracker(surface, publicEnv).then((tracker) => {
      if (!tracker) {
        return;
      }

      window.__louezOpenReplayStartPromise ??= tracker.start({
        userID: user?.email,
        metadata: {
          surface,
          ...(user?.id && { userId: user.id }),
          ...(user?.email && { email: user.email }),
          ...(user?.name && { name: user.name }),
          ...(store && {
            storeId: store.id,
            storeName: store.name,
            ...(store.slug && { storeSlug: store.slug }),
          }),
        },
      });

      void window.__louezOpenReplayStartPromise.then(() => {
        markOpenReplayReady(({ name, payload }) => {
          tracker.event(name, payload);
        });
      });
    });
  }, [publicEnv, store, surface, user]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    void getOpenReplayTracker(surface, publicEnv).then((tracker) => {
      if (!tracker) {
        return;
      }

      tracker.setMetadata("surface", surface);

      if (user) {
        tracker.setUserID(user.email);
        tracker.setMetadata("userId", user.id);
        tracker.setMetadata("email", user.email);

        if (user.name) {
          tracker.setMetadata("name", user.name);
        }
      }

      if (store) {
        tracker.setMetadata("storeId", store.id);
        tracker.setMetadata("storeName", store.name);

        if (store.slug) {
          tracker.setMetadata("storeSlug", store.slug);
        }
      }
    });
  }, [publicEnv, store, surface, user]);

  return <>{children}</>;
};
