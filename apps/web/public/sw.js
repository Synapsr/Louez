/**
 * Louez dashboard service worker — web push only (no offline/precaching).
 * Served with Cache-Control: no-cache so updates propagate immediately.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch  {
    payload = { title: 'Louez', body: event.data.text() };
  }

  const title = payload.title || 'Louez';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/dashboard' },
  };

  event.waitUntil(
    (async () => {
      // Foreground de-duplication: if a dashboard tab is already open and
      // focused, the in-app toast + sound already cover it — don't double-notify.
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const focused = windows.some(
        (client) => client.focused && client.visibilityState === 'visible',
      );
      if (focused) return;

      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || '/dashboard';
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Reuse an existing tab if one is open.
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch  {
              /* navigation across origins can throw — ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
