/* Notifications only. This service worker is registered with the scope
   /push/, so it never controls an app page: a service worker that controls
   the page breaks PDF uploads on iPhone (see the head of each page). It has
   no fetch handler and caches nothing. It shows the alerts the listener
   Worker sends (cloudflare/listener) and opens the right screen on a tap. */

/* The app's folder: the one above this worker's /push/ scope. "/" on Vercel,
   "/Owner-App/" on the old GitHub Pages copy. */
const ROOT = new URL('../', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data && event.data.text() }; }
  // iPhone requires every push to show a notification, so there is always one.
  event.waitUntil(self.registration.showNotification(d.title || 'My Mechanic QLD', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: ROOT + 'icon-192.png',
    badge: ROOT + 'icon-192.png',
    data: { url: d.url || '/' },
    // Web apps cannot choose their own sound (iPhone always plays the system
    // alert, Android the browser's), so make it strong where the phone allows:
    // a long vibration and staying on screen until dismissed on Android, and a
    // fresh alert, not a silent update, when the same conversation alerts again.
    vibrate: [400, 150, 400, 150, 800],
    requireInteraction: d.tag !== 'test',
    renotify: !!d.tag,
  }));
});

/* The tapped link is also written to IndexedDB, which the app shares with
   this worker. The app reads it whenever it starts or comes to the front.
   That is what makes the tap reliable on iPhone: a message to an open window
   is not delivered to a page this worker does not control (none, on
   purpose), and opening a window may just bring the app forward. */
function savePending(url) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('mmqld-push', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ url, at: Date.now() }, 'open');
          tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
        } catch (_) { resolve(); }
      };
      req.onerror = () => resolve();
    } catch (_) { resolve(); }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Alerts carry app links like "/?open=<id>"; resolve them inside the app's folder.
  const url = new URL(String((event.notification.data && event.notification.data.url) || '').replace(/^\//, ''), ROOT).href;
  event.waitUntil((async () => {
    await savePending(url);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      // The app is open: bring it forward and tell it what to show.
      if (w.url.startsWith(ROOT) && 'focus' in w) {
        await w.focus();
        w.postMessage({ mmqldOpen: url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
