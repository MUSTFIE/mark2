/* 記帳本 Service Worker — 快取靜態資源，加速重複開啟 */
const CACHE = 'accounting-static-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/config.js',
  './js/core.js',
  './js/pages.js',
  './js/actions.js',
  './js/export.js',
  './js/app.js',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 不攔截 Firebase / 跨域 API
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        if (res && res.ok && (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('/'))) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      // 網路優先，失敗才用快取（較易取得新版 app.js）
      return fetched;
    })
  );
});
