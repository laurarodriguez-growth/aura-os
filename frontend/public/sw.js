const CACHE_NAME = 'aura-os-v6-1-logo-oficial-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest-v3.webmanifest',
  './aura-os-favicon-v3.svg',
  './aura-os-favicon-v3-32.png',
  './aura-os-logo-currentcolor.svg',
  './icons/aura-os-app-v3-192.png',
  './icons/aura-os-app-v3-512.png',
  './icons/aura-os-maskable-v3-192.png',
  './icons/aura-os-maskable-v3-512.png',
  './icons/aura-os-apple-touch-v3-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/config.js')) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))),
  );
});
