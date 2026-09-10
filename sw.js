/* ============================================================
   Service Worker — بيتنا
   يعمل بدون إنترنت، ويحدّث نفسه فورًا عند نشر نسخة جديدة.
   ============================================================ */

const VERSION = 'beitna-v1.8.1';
const NET_TIMEOUT = 4000;

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/ui.js',
  './js/router.js',
  './js/notify.js',
  './js/cloud.js',
  './js/screens/auth.js',
  './js/screens/home.js',
  './js/screens/shopping.js',
  './js/screens/faults.js',
  './js/screens/occasions.js',
  './js/screens/more.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** الشبكة أولًا مع مهلة، ثم النسخة المحفوظة */
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT)),
    ]);
    if (res && res.ok) {
      cache.put(cacheKey || request, res.clone());
      return res;
    }
    throw new Error('bad response');
  } catch {
    const hit = await cache.match(cacheKey || request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./'));
    }
    throw new Error('offline');
  }
}

/** المحفوظ أولًا (للصور والخطوط والموارد الثابتة) */
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!url.protocol.startsWith('http')) return;

  /* صفحات التنقّل: index.html من الشبكة ثم المحفوظ */
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('./index.html', { cache: 'no-cache' }), './index.html'));
    return;
  }

  /* موارد خارجية (خطوط Google و Firebase): المحفوظ أولًا */
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirst(req).catch(() => caches.match(req)));
    return;
  }

  /* كود التطبيق: الشبكة أولًا حتى يصل أي تحديث فورًا */
  if (/\.(js|css|webmanifest|json)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  /* الباقي (الصور والأيقونات): المحفوظ أولًا */
  event.respondWith(cacheFirst(req).catch(() => caches.match(req)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
