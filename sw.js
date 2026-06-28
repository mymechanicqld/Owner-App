/* Service worker: network-first so the app always loads the latest code when
   online, falling back to cache only when offline.
   Data (Supabase, Gmail, CDNs) is cross-origin and goes straight to network. */
const CACHE = 'mmqld-owner-v16';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.json', './favicon-32x32.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // let network handle API/CDN
  // Network-first: fetch fresh, cache it, fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
