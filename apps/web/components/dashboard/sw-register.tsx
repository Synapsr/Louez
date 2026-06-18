'use client';

import { useEffect } from 'react';

/**
 * Registers the dashboard service worker (used for web push). Mounted once in
 * the dashboard layout; a no-op where service workers aren't supported.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration fails on unsupported/insecure contexts — push is then
      // simply unavailable; nothing else depends on it.
    });
  }, []);

  return null;
}
