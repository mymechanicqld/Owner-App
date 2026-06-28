/* Service worker: NO caching of app code.
   Repeated stale-cache problems on iOS (old service workers serving old JS that
   never updated) outweigh any offline benefit for this owner console. This SW
   deletes every cache it finds and serves nothing from cache, so the app always
   loads the latest code straight from the network. A no-op fetch handler is
   kept only so the app still satisfies Android's installability requirement.
   Data (Supabase, Gmail, CDNs) is cross-origin and goes straight to network. */
const VERSION = 'mmqld-owner-v18-nocache';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Pass-through: do NOT call respondWith, so the browser handles every request
   over the network. Present purely so the app counts as installable. */
self.addEventListener('fetch', () => {});
