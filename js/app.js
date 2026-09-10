/* ============================================================
   بيتنا — نسخة الويب (PWA)
   نقطة البداية: الهيكل، التنقل، المظهر، والتثبيت
   ============================================================ */

import { $, esc } from './util.js';
import {
  getState, subscribe, update, applyRemote, setCloudBridge, setCloudUid,
  setLogoutHook, setupHousehold,
} from './store.js';
import * as cloud from './cloud.js';
import { route, setNotFound, setOnChange, start, go, back, currentPath } from './router.js';
import { renderAuth } from './screens/auth.js';
import { homeScreen } from './screens/home.js';
import { shoppingScreen, shoppingFormScreen, shoppingDetailsScreen, shoppingSessionScreen } from './screens/shopping.js';
import { faultsScreen, faultFormScreen, faultDetailsScreen } from './screens/faults.js';
import { occasionsScreen, occasionFormScreen, occasionDetailsScreen } from './screens/occasions.js';
import {
  moreScreen, profileScreen, householdScreen, notificationsScreen,
  categoriesScreen, archiveScreen, supportScreen,
} from './screens/more.js';
import { emptyState, toast } from './ui.js';
import { startReminderLoop, notifyPartner } from './notify.js';

/* ============================================================
   مسارات الإنقاذ:
   ?reset=1    → يمسح الذاكرة المؤقتة فقط (البيانات تبقى)
   ?reset=all  → يمسح كل شيء: البيانات والحساب والذاكرة
   ============================================================ */
export async function wipeEverything(includeData) {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* تجاهل */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* تجاهل */ }
  if (!includeData) return;
  try { await cloud.signOutCloud(); } catch { /* تجاهل */ }
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* تجاهل */ }
  try {
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(dbs.map((d) => d.name && new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    })));
  } catch { /* تجاهل */ }
}

if (location.search.includes('reset')) {
  const all = location.search.includes('all');
  wipeEverything(all).finally(() => {
    location.replace(location.origin + location.pathname);
  });
}

/* ---------- التنقل السفلي ---------- */
const NAV = [
  { route: '/home', label: 'الرئيسية', icon: '🏠' },
  { route: '/shopping', label: 'المشتريات', icon: '🛒' },
  { route: '/faults', label: 'الأعطال', icon: '🔧' },
  { route: '/occasions', label: 'المناسبات', icon: '🎉' },
  { route: '/more', label: 'المزيد', icon: '☰' },
];

let current = null;   // آخر شاشة معروضة
let currentFactory = null;
let currentParams = {};

/* ---------- المظهر ---------- */
function applyTheme() {
  const dark = getState().settings.darkMode;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#10161C' : '#0F8B6D');
}

/* ---------- رسم الشاشة ---------- */
function render(factory, params = {}) {
  currentFactory = factory;
  currentParams = params;
  const screen = factory(params);
  current = screen;

  const topbar = $('#topbar');
  topbar.innerHTML = `
    ${screen.back ? `<button class="icon-btn" data-back aria-label="رجوع">›</button>` : ''}
    <div class="grow">
      <h1>${esc(screen.title)}</h1>
      ${screen.subtitle ? `<div class="sub">${esc(screen.subtitle)}</div>` : ''}
    </div>
    ${screen.actions || ''}`;

  const view = $('#view');
  view.innerHTML = screen.html + (screen.fab
    ? `<button class="fab" data-fab>${esc(screen.fab.label)}</button>` : '');

  view.scrollTop = 0;
  window.scrollTo({ top: 0 });

  screen.mount?.(view, rerender);

  view.querySelector('[data-fab]')?.addEventListener('click', () => {
    if (screen.fab.to) go(screen.fab.to);
    else screen.fab.onClick?.();
  });

  topbar.querySelector('[data-back]')?.addEventListener('click', () => back());
  topbar.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', () => screen.topActions?.(b.dataset.act, rerender));
  });

  paintNav();
}

function rerender() {
  if (currentFactory) render(currentFactory, currentParams);
}

/* ---------- شريط التنقل ---------- */
function navHtml(withBrand) {
  const path = currentPath();
  const root = '/' + (path.split('/')[1] || 'home');
  return (withBrand ? `<div class="brand"><span class="logo">🏡</span> بيتنا</div>` : '') +
    NAV.map((n) => `
      <button class="navitem ${n.route === root ? 'active' : ''}" data-go="${n.route}">
        <span class="ic">${n.icon}</span><span>${n.label}</span>
      </button>`).join('');
}

function paintNav() {
  $('#bottomnav').innerHTML = navHtml(false);
  $('#sidenav').innerHTML = navHtml(true);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && b.closest('#bottomnav, #sidenav')) go(b.dataset.go);
});

/* ---------- المسارات ---------- */
route('/home', () => render(homeScreen));

route('/shopping', () => render(shoppingScreen));
route('/shopping/new', () => render(shoppingFormScreen));
route('/shopping/session', () => render(shoppingSessionScreen));
route('/shopping/:id', (p) => render(shoppingDetailsScreen, p));

route('/faults', () => render(faultsScreen));
route('/faults/new', () => render(faultFormScreen));
route('/faults/:id', (p) => render(faultDetailsScreen, p));

route('/occasions', () => render(occasionsScreen));
route('/occasions/new', () => render(occasionFormScreen));
route('/occasions/:id', (p) => render(occasionDetailsScreen, p));

route('/more', () => render(moreScreen));
route('/profile', () => render(profileScreen));
route('/household', () => render(householdScreen));
route('/notifications', () => render(notificationsScreen));
route('/categories', () => render(categoriesScreen));
route('/archive', () => render(archiveScreen));
route('/support', () => render(supportScreen));

setNotFound(() => render(() => ({
  title: 'الصفحة غير موجودة',
  back: true,
  html: emptyState('🧭', 'لم نجد هذه الصفحة', 'ارجع للرئيسية وواصل من هناك'),
})));

setOnChange(applyTheme);

/* ============================================================
   جلسة السحابة
   ============================================================ */
function cloudBridge(hid) {
  return {
    save: (col, item) => cloud.saveItem(hid, col, item),
    patch: (col, id, patch) => cloud.patchItem(hid, col, id, patch),
    remove: (col, id) => cloud.removeItem(hid, col, id),
    profile: (_, patch) => cloud.updateMemberProfile(hid, patch),
    removeMember: (_, uid) => cloud.removeMemberCloud(hid, uid),
    prefs: (_, prefs) => cloud.saveNotificationPrefs(prefs),
  };
}

function startCloudSession(hid) {
  setCloudUid(cloud.currentUid());
  setCloudBridge(cloudBridge(hid), hid);

  cloud.startSync(hid, {
    onData(col, items) {
      if (col === 'members') {
        const me = items.find((m) => m.uid === cloud.currentUid());
        update((st) => {
          st.members = items;
          if (me) {
            st.profile.isOwner = me.isOwner;
            st.profile.role = me.role;
            if (me.name) st.profile.name = me.name;
            if (me.phone) st.profile.phone = me.phone;
          }
        });
      } else if (col === 'categories' && items.length === 0) {
        /* لا نفرّغ التصنيفات إن لم تصل من السحابة — نبقي الافتراضية */
      } else {
        applyRemote(col, items);
      }
      rerender();
    },
    onPartnerActivity(text) {
      notifyPartner(text);
      toast(text);
    },
  });

  cloud.recordSession();
}

cloud.setWriteErrorHandler?.((msg) => toast(msg, 4000));

setLogoutHook(() => {
  cloud.stopSync();
  cloud.signOutCloud();
  setCloudBridge(null, null);
  setCloudUid(null);
});

/* ---------- الإقلاع ---------- */
let booted = false;

/** شبكة أمان: مهما حدث، لا تبقَ شاشة البداية عالقة */
function failsafe() {
  setTimeout(() => {
    if (booted) return;
    console.warn('الإقلاع تأخّر — عرض الواجهة بدون انتظار السحابة');
    showApp();
  }, 10000);
}

function showApp() {
  if (booted) return;
  booted = true;
  const s = getState();
  $('#app').hidden = false;
  hideSplash();
  if (s.onboarded) {
    $('#shell').hidden = false;
    startApp();
  } else {
    renderAuth((res) => {
      $('#shell').hidden = false;
      if (res?.cloud && res.hid) startCloudSession(res.hid);
      startApp();
    });
  }
}

async function boot() {
  applyTheme();
  failsafe();
  const s = getState();

  /* ===== مُهيّأ مسبقًا: نعرض آخر بيانات محفوظة فورًا، والسحابة تلحق لاحقًا ===== */
  if (s.onboarded) {
    showApp();
    if (s.household?.cloud) restoreCloud();   // في الخلفية، بلا انتظار
    return;
  }

  /* ===== أول تشغيل: نحاول استعادة جلسة سحابية قبل عرض شاشة الدخول ===== */
  const restored = await restoreCloud();
  if (!restored) showApp();
}

/** يستعيد جلسة السحابة ويشغّل المزامنة. يرجع true عند النجاح. */
async function restoreCloud() {
  try {
    if (!(await cloud.initCloud())) return false;
    const user = await cloud.waitForUser();
    if (!user) return false;

    const hid = await cloud.loadHouseholdId();
    if (!hid) return false;

    const hh = await cloud.loadHousehold(hid);
    setupHousehold({
      householdName: hh?.name || getState().household.name || 'بيتي',
      memberName: user.displayName || getState().profile.name || (user.email || '').split('@')[0],
      email: user.email || '',
      inviteCode: hh?.inviteCode || getState().household.inviteCode || '',
      isOwner: getState().profile.isOwner,
      cloud: true,
    });

    startCloudSession(hid);
    if (!booted) showApp();
    else rerender();
    return true;
  } catch (e) {
    console.warn('تعذّرت استعادة الجلسة السحابية', e);
    return false;
  }
}

function startApp() {
  $('#authRoot').hidden = true;
  paintNav();
  start();
  startReminderLoop();
  subscribe(applyTheme);
}

function hideSplash() {
  const sp = $('#splash');
  setTimeout(() => {
    sp.classList.add('hide');
    setTimeout(() => sp.remove(), 400);
  }, 380);
}

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator) {
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // أول تثبيت: لا نحدّث
    reloading = true;
    location.reload();                          // نسخة جديدة وصلت
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 3600000);
      })
      .catch(() => { /* تجاهل */ });
  });
}

/* ---------- التثبيت على الجهاز ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallHint();
});

function showInstallHint() {
  if (localStorage.getItem('beitna:install-dismissed')) return;
  const view = $('#view');
  if (!view || view.querySelector('.install-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'install-bar';
  bar.innerHTML = `
    <span style="font-size:22px">📲</span>
    <div class="grow"><div class="strong small">ثبّت بيتنا على جهازك</div>
      <div class="tiny muted">يعمل بدون إنترنت وكأنه تطبيق مستقل.</div></div>
    <button class="btn sm" data-install>تثبيت</button>
    <button class="icon-btn" data-dismiss aria-label="إغلاق">✕</button>`;
  view.prepend(bar);
  bar.querySelector('[data-install]').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const res = await deferredPrompt.userChoice;
    deferredPrompt = null;
    bar.remove();
    if (res.outcome === 'accepted') toast('تم التثبيت ✓');
  };
  bar.querySelector('[data-dismiss]').onclick = () => {
    localStorage.setItem('beitna:install-dismissed', '1');
    bar.remove();
  };
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  toast('تم تثبيت بيتنا على جهازك 🎉');
});

/* ---------- حالة الاتصال ---------- */
window.addEventListener('offline', () => toast('أنت غير متصل — التطبيق يعمل محليًا'));

/* ---------- التشغيل ---------- */
boot().catch((e) => {
  console.error('فشل الإقلاع', e);
  try { showApp(); } catch (e2) {
    document.getElementById('splash')?.remove();
    document.body.innerHTML =
      '<div style="padding:32px;text-align:center;font-family:Tajawal,system-ui">' +
      '<div style="font-size:44px">⚠️</div>' +
      '<h2 style="margin:8px 0">تعذّر تشغيل التطبيق</h2>' +
      '<p style="color:#6B7280">حدّث الصفحة، وإن تكرر الخطأ اضغط الزر أدناه لمسح الذاكرة المؤقتة.</p>' +
      '<button onclick="(async()=>{const r=await navigator.serviceWorker.getRegistrations();' +
      'for(const x of r)await x.unregister();const k=await caches.keys();' +
      'for(const c of k)await caches.delete(c);location.reload(true)})()" ' +
      'style="padding:12px 22px;border-radius:999px;background:#0F8B6D;color:#fff;font-weight:700;border:0">' +
      'إعادة الضبط وتحديث</button></div>';
  }
});
