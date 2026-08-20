/**
 * OrderFlow PWA service worker.
 *
 * Cache strategy:
 *  - HTML documents and JS/WASM entry points (index.html, main.dart.js,
 *    flutter.js, flutter_bootstrap.js, *.wasm, drift_worker.dart.js):
 *    NETWORK-FIRST. The browser always tries the network so a new deploy is
 *    picked up immediately, falling back to cache only when offline.
 *  - Static hashed assets (canvaskit/*, assets/*, icons/*, fonts): cache-first
 *    (their names are content-hashed, so staleness is impossible).
 *  - Everything else (cross-origin API, proxy): straight to the network, never
 *    cached (and cannot be — they are different origins).
 *
 * The cache key is bumped on every release via CACHE_VERSION below. On
 * activate, any older cache version is deleted, which is what forces users out
 * of a stale build after an update.
 */

// Bump this on every deploy. Stale caches (older versions) are wiped on activate.
const CACHE_VERSION = '2.7.9-15';
const CACHE = `orderflow-pwa-${CACHE_VERSION}`;

// Core app shell — precached on install for offline support.
const SHELL = [
  './',
  './index.html',
  './flutter_bootstrap.js',
  './flutter.js',
  './main.dart.js',
  './orderflow_web.js',
  './manifest.json',
  './favicon.png',
  './sqlite3.wasm',
  './drift_worker.dart.js',
  './icons/Icon-any-v2-192.png',
  './icons/Icon-any-v2-512.png',
  './icons/Icon-maskable-v2-192.png',
  './icons/Icon-maskable-v2-512.png',
  './icons/apple-touch-icon-v2-180.png',
];

// Network-first for these (always pick up new deploys immediately).
const NETWORK_FIRST = [
  'index.html',
  'flutter_bootstrap.js',
  'main.dart.js',
  'orderflow_web.js',
  'drift_worker.dart.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() =>
        // Tell open tabs a new SW took over so the app can refresh itself.
        self.clients.matchAll({ includeUncontrolled: true }).then((clients) =>
          clients.forEach((client) =>
            client.postMessage({ type: 'SW_UPDATED' }),
          ),
        ),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle same-origin GETs; cross-origin (Worker/1C) goes straight out.
  if (url.origin !== self.location.origin) return;

  const filename = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);

  // 1. HTML navigations: network-first (fresh deploy wins).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // 2. Critical app files: network-first so deploys apply immediately.
  if (NETWORK_FIRST.includes(filename)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // 3. Hashed static assets: cache-first (immutable by name).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});
