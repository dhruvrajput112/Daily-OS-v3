/* ═══════════════════════════════════════════════════
   Daily OS — Service Worker
   Strategy:
   - App shell (HTML, fonts, CDN scripts) → Cache First
   - Supabase API calls → Network First (never cache auth/data)
   - Everything else → Network First with cache fallback
═══════════════════════════════════════════════════ */

const CACHE_NAME    = 'daily-os-v1';
const OFFLINE_URL   = '/';

// Resources to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── INSTALL ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache what we can; ignore failures for CDN resources
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(() => {
            // CDN or font failures are fine — they'll be cached on first use
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Supabase API — always network only, never cache auth or data
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Google Fonts API (stylesheet) — network first, cache fallback
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // 3. Google Fonts static files (actual font files) — cache first
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // 4. CDN scripts (Supabase JS library) — cache first
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // 5. App shell (same origin) — cache first, fallback to network
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // 6. Everything else — network first
  event.respondWith(networkFirstWithCache(event.request));
});

// ── STRATEGY: Cache First, fallback to Network ──────
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — return offline page for navigation
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match(OFFLINE_URL);
      if (offlinePage) return offlinePage;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── STRATEGY: Network First, fallback to Cache ──────
async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match(OFFLINE_URL);
      if (offlinePage) return offlinePage;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}
