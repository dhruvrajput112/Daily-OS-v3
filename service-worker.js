/* ═══════════════════════════════════════════════════
   Daily OS — Service Worker (minimal/safe)
   No fetch interception. Registers for PWA installability only.
   Caching is handled passively — never blocks or modifies requests.
═══════════════════════════════════════════════════ */

const CACHE_NAME = 'daily-os-v2';

// Install — cache only the bare HTML shell, nothing external
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add('/'))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // never block install
  );
});

// Activate — clean up old caches, take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — pass EVERYTHING through to the network untouched.
// No caching logic here. This prevents any possibility of the SW
// serving a broken/stale version of the Supabase CDN script.
self.addEventListener('fetch', (event) => {
  // Let the browser handle all requests normally
  return;
});
