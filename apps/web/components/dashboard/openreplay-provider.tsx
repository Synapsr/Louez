'use client';

import Tracker from '@openreplay/tracker/cjs';
import { useEffect } from 'react';

import { env } from '@/env';

let openReplayTracker: Tracker | null = null;
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

function getOpenReplayTracker() {
  if (!openReplayTracker) {
    openReplayTracker = new Tracker({
      projectKey: env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY,
      ingestPoint: env.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT,
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

    const tracker = getOpenReplayTracker();

    if (!tracker) {
      return;
    }

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
  }, [store, user]);

  useEffect(() => {
    const tracker = getOpenReplayTracker();

    if (!tracker || !user) {
      return;
    }

    tracker.setUserID(user.id);
    tracker.setMetadata('email', user.email);

    if (user.name) {
      tracker.setMetadata('name', user.name);
    }

    if (store) {
      tracker.setMetadata('storeId', store.id);
      tracker.setMetadata('storeName', store.name);
    }
  }, [store, user]);

  return <>{children}</>;
}
