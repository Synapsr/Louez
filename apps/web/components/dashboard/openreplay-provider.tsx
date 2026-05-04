'use client';

import { useEffect } from 'react';

import { env } from '@/env';

const OPENREPLAY_PROJECT_KEY =
  env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY || 'W9AU13WEWMDZ4m8KQzWZ';
const OPENREPLAY_INGEST_POINT =
  env.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT ||
  'https://replay.lumy.cloud/ingest';

type OpenReplayTracker = InstanceType<
  Awaited<typeof import('@openreplay/tracker')>['default']
>;

let openReplayTracker: OpenReplayTracker | null = null;
let openReplayStartPromise: Promise<unknown> | null = null;

interface OpenReplayProviderProps {
  children: React.ReactNode;
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
  store?: {
    id: string;
    name: string;
  };
}

async function getOpenReplayTracker() {
  if (!openReplayTracker) {
    const { default: Tracker } = await import('@openreplay/tracker');

    openReplayTracker = new Tracker({
      projectKey: OPENREPLAY_PROJECT_KEY,
      ingestPoint: OPENREPLAY_INGEST_POINT,
      respectDoNotTrack: true,
      privateMode: true,
      obscureTextEmails: true,
      obscureTextNumbers: true,
      obscureInputEmails: true,
      obscureInputNumbers: true,
      obscureInputDates: true,
      network: {
        sessionTokenHeader: false,
        failuresOnly: false,
        capturePayload: false,
        captureInIframes: false,
        ignoreHeaders: true,
      },
    });
  }

  return openReplayTracker;
}

export function OpenReplayProvider({
  children,
  user,
  store,
}: OpenReplayProviderProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    void getOpenReplayTracker().then((tracker) => {
      openReplayStartPromise ??= tracker.start({
        userID: user?.id,
        metadata: {
          ...(user?.email && { email: user.email }),
          ...(user?.name && { name: user.name }),
          ...(store && {
            storeId: store.id,
            storeName: store.name,
          }),
        },
      });
    });
  }, [store, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void getOpenReplayTracker().then((tracker) => {
      tracker.setUserID(user.id);
      tracker.setMetadata('email', user.email);

      if (user.name) {
        tracker.setMetadata('name', user.name);
      }

      if (store) {
        tracker.setMetadata('storeId', store.id);
        tracker.setMetadata('storeName', store.name);
      }
    });
  }, [store, user]);

  return <>{children}</>;
}
