'use client';

import { useEffect } from 'react';

import { env } from '@/env';
import { markOpenReplayReady } from '@/lib/openreplay/client';

const OPENREPLAY_DASHBOARD_PROJECT_KEY =
  env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY || 'W9AU13WEWMDZ4m8KQzWZ';
const OPENREPLAY_STOREFRONT_PROJECT_KEY =
  env.NEXT_PUBLIC_OPENREPLAY_STOREFRONT_PROJECT_KEY || '';
const OPENREPLAY_INGEST_POINT =
  env.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT ||
  'https://replay.lumy.cloud/ingest';

type OpenReplayTracker = InstanceType<
  Awaited<typeof import('@openreplay/tracker')>['default']
>;

type OpenReplaySurface = 'dashboard' | 'storefront';

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

function getSurfaceProjectKey(surface: OpenReplaySurface) {
  return surface === 'dashboard'
    ? OPENREPLAY_DASHBOARD_PROJECT_KEY
    : OPENREPLAY_STOREFRONT_PROJECT_KEY;
}

function getSurfaceTrackerOptions(surface: OpenReplaySurface) {
  if (surface === 'dashboard') {
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

async function getOpenReplayTracker(surface: OpenReplaySurface) {
  const projectKey = getSurfaceProjectKey(surface);

  if (!projectKey) {
    return null;
  }

  if (
    window.__louezOpenReplayTracker &&
    window.__louezOpenReplayProjectKey === projectKey
  ) {
    return window.__louezOpenReplayTracker;
  }

  window.__louezOpenReplayTrackerPromise ??= (async () => {
    const { default: Tracker } = await import('@openreplay/tracker');

    window.__louezOpenReplayTracker = new Tracker({
      projectKey,
      ingestPoint: OPENREPLAY_INGEST_POINT,
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

export function OpenReplayProvider({
  children,
  surface,
  user,
  store,
}: OpenReplayProviderProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    void getOpenReplayTracker(surface).then((tracker) => {
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
  }, [store, surface, user]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    void getOpenReplayTracker(surface).then((tracker) => {
      if (!tracker) {
        return;
      }

      tracker.setMetadata('surface', surface);

      if (user) {
        tracker.setUserID(user.email);
        tracker.setMetadata('userId', user.id);
        tracker.setMetadata('email', user.email);

        if (user.name) {
          tracker.setMetadata('name', user.name);
        }
      }

      if (store) {
        tracker.setMetadata('storeId', store.id);
        tracker.setMetadata('storeName', store.name);

        if (store.slug) {
          tracker.setMetadata('storeSlug', store.slug);
        }
      }
    });
  }, [store, surface, user]);

  return <>{children}</>;
}
