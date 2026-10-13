/* Notifications only. This service worker is registered with the scope
   /push/, so it never controls an app page: a service worker that controls
   the page breaks PDF uploads on iPhone (see the head of each page). It has
   no fetch handler and caches nothing. It shows the alerts the listener
   Worker sends (cloudflare/listener) and opens the right screen on a tap. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data && event.data.text() }; }
  // iPhone requires every push to show a notification, so there is always one.
  event.waitUntil(self.registration.showNotification(d.title || 'My Mechanic QLD', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      // The app is open: bring it forward and tell it what to show.
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        w.postMessage({ mmqldOpen: url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
