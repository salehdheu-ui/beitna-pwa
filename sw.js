/* ============================================================
   Service Worker — بيتنا
   يعمل بدون إنترنت، ويحدّث نفسه فورًا عند نشر نسخة جديدة.
   ============================================================ */

const VERSION = 'beitna-v3.23.0';
const NET_TIMEOUT = 2500;

/* لوحة الإدارة ليست جزءًا من الـ PWA إطلاقًا. يجب أن تمر ملفاتها إلى الشبكة
   مباشرة، وإلا يعامل طلب admin.html كتصفّح داخل التطبيق ويعيد index.html. */
const ADMIN_PATHS = new Set(['/admin.html', '/css/admin.css', '/js/admin-app.js']);

const CORE = [
  './',
  './index.html',
  './manifest.json',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/ui.js',
  './js/router.js',
  './js/notify.js',
  './js/i18n.js',
  './js/push.js',
  './js/screens/helper.js',
  './js/cloud.js',
  './js/screens/auth.js',
  './js/screens/home.js',
  './js/screens/shopping.js',
  './js/screens/faults.js',
  './js/screens/occasions.js',
  './js/screens/more.js',
  './js/screens/control.js',
  './js/screens/pantry.js',
  './js/pantry-data.js',
  './js/diag.js',
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
  const activated = (async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })();
  event.waitUntil(activated);

  /* بعد اكتمال التفعيل — وخارج الوعد الذي ينتظره activate — نبلّغ كل
     نافذة ونطلب تنقّلها إلى عنوانها نفسه. التنقّل غير داخل waitUntil كي
     لا يحدث اعتماد دائري، ويضمن وصول النسخة الجديدة حتى للأجهزة التي
     ما زالت تشغّل كودًا قديمًا لا يفهم رسالة app-update. */
  activated.then(async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try { client.postMessage({ type: 'app-update', version: VERSION }); } catch { /* تجاهل */ }
      try { client.navigate(client.url).catch(() => {}); } catch { /* تجاهل */ }
    }
  }).catch(() => {});
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

/**
 * المحفوظ فورًا ثم التحديث في الخلفية.
 * كود التطبيق كان يُجلب بـ«الشبكة أولًا»، ووحدات ES تُحمَّل على شكل سلسلة:
 * index.html ← app.js ← مستورداته ← مستوردات هذه. فعلى شبكة موصولة لكنها
 * لا تردّ، تتراكم المهلة على كل طبقة ويتأخّر أول رسم عشرات الثواني.
 * هنا يُعرض المحفوظ فورًا وتصل النسخة الجديدة مع الإقلاع التالي.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);

  const update = fetch(request, { cache: 'no-cache' })
    .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);

  /* التحديث يكمل في الخلفية بعد تسليم النسخة المحفوظة */
  if (hit) { try { event.waitUntil(update); } catch { /* تجاهل */ } return hit; }

  const res = await update;
  if (res) return res;
  throw new Error('offline');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!url.protocol.startsWith('http')) return;

  /* لا نعترض لوحة الإدارة ولا ملفاتها، حتى في طلبات التنقّل. */
  if (url.origin === location.origin && ADMIN_PATHS.has(url.pathname)) return;

  /* طلبات الخادم (/api) لا تُخزَّن إطلاقًا — التطبيق يدير العمل بدون إنترنت بنفسه */
  if (url.origin === location.origin && url.pathname.startsWith('/api')) return;

  const offline = self.navigator && self.navigator.onLine === false;

  /* صفحات التنقّل: الهيكل من المحفوظ فورًا (نمط app-shell)
     الهيكل لا يحمل إلا روابط ثابتة لـ app.js و app.css، فتقادمه بلا أثر،
     وأي نشر جديد يرفع VERSION فيُعاد بناء المخزون ويُعاد تحميل الصفحة. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = (await cache.match('./index.html')) || (await cache.match('./'));
      if (hit) {
        if (!offline) {
          const update = fetch(new Request('./index.html', { cache: 'no-cache' }))
            .then((res) => { if (res && res.ok) cache.put('./index.html', res.clone()); })
            .catch(() => {});
          try { event.waitUntil(update); } catch { /* تجاهل */ }
        }
        return hit;
      }
      return networkFirst(new Request('./index.html', { cache: 'no-cache' }), './index.html');
    })());
    return;
  }

  /* موارد خارجية (خطوط Google): المحفوظ أولًا */
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirst(req).catch(() => caches.match(req)));
    return;
  }

  /* كود التطبيق: المحفوظ فورًا، والتحديث يجري في الخلفية */
  if (/\.(js|css|webmanifest|json)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, event).catch(() => caches.match(req)));
    return;
  }

  /* الباقي (الصور والأيقونات): المحفوظ أولًا */
  event.respondWith(cacheFirst(req).catch(() => caches.match(req)));
});

/* ============================================================
   الإشعارات
   ============================================================ */
const APP_URL = './';

/** فتح/تركيز التطبيق عند الضغط على الإشعار */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || APP_URL, self.registration.scope).href;

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try { await c.focus(); } catch { /* تجاهل */ }
      try { c.postMessage({ type: 'notification-click', url: data.url || APP_URL }); } catch { /* تجاهل */ }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

/** رسائل Web Push (تحتاج خادمًا يرسلها — جاهزة للاستخدام عند تفعيلها) */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: (event.data && event.data.text && event.data.text()) || '' }; }

  const title = payload.title || 'Beitna';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    lang: payload.lang || 'ar',
    dir: payload.dir || (payload.lang === 'ar' ? 'rtl' : 'ltr'),
    tag: payload.tag || 'beitna-push',
    data: { url: payload.url || APP_URL },
  }));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

