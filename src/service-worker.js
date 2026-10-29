// Offline support. Built into dist/sw.js by the pwa plugin in vite.config.ts, which fills in
// the version and the list of files to keep. This file is not part of the app bundle.

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `pdforge-${VERSION}`;
// cache names start with the build time, so they sort oldest first
const KEEP_VERSIONS = 2;
// Our files never vary by request headers. Ignoring Vary matters: servers may send
// "Vary: Origin", and the page asks for its scripts with an Origin header that the
// install-time requests didn't have, so a strict match would miss them offline.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Keep the previous version too: a page opened before the update may still lazy-load its files.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const ours = keys.filter((key) => key.startsWith('pdforge-')).sort();
        return Promise.all(ours.slice(0, -KEEP_VERSIONS).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // the page itself: network first, so a new version arrives as soon as there is a connection
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('./', MATCH)) ?? caches.match('./index.html', MATCH)),
    );
    return;
  }

  // everything else has a content hash in its name (or never changes): cache first,
  // and keep anything fetched later, such as the pdf.js font and CMap files
  event.respondWith(
    caches.match(request, MATCH).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
