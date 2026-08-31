const CACHE='pozitron-v72-shell-f4e6580ecb8f';

const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  './sprint-marathon.js',
  './max-retro.js',
  './next-draw-banner.js',
  './icon-v72.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Данные всегда идут из сети и не замораживаются оболочкой.
  if (
    url.pathname.endsWith('/keno-history.json') ||
    url.pathname.endsWith('/keno-auto.json')
  ) {
    event.respondWith(fetch(new Request(event.request, { cache: 'no-store' })));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Оболочка: network-first, cache только как offline fallback.
  event.respondWith(
    fetch(new Request(event.request, { cache: 'no-store' }))
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
