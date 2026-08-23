const CACHE_NAME = 'vocale-ai-cache-v2';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching App Shell');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Skip Gemini API requests
  if (url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache, but update it in the background if it's a local resource
          if (ASSETS.some(asset => url.endsWith(asset) || url === self.location.origin + '/')) {
            fetch(event.request)
              .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                  caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
                }
              })
              .catch(() => {
                // Offline or network error - fail silently as we have the cached version
              });
          }
          return cachedResponse;
        }

        // Cache dynamically other GET requests (like Google Fonts)
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic' && !url.includes('fonts.googleapis.com') && !url.includes('fonts.gstatic.com')) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return response;
        });
      })
  );
});
