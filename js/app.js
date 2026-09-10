/* ============================================================
   بيتنا — نسخة الويب (PWA)
   نقطة البداية: الهيكل، التنقل، المظهر، والتثبيت
   ============================================================ */

import { $, esc } from './util.js';
import { getState, subscribe } from './store.js';
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
import { startReminderLoop } from './notify.js';

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

/* ---------- الإقلاع ---------- */
function boot() {
  applyTheme();
  const s = getState();

  if (!s.onboarded) {
    $('#app').hidden = false;
    hideSplash();
    renderAuth(() => { $('#shell').hidden = false; startApp(); });
    return;
  }

  $('#app').hidden = false;
  $('#shell').hidden = false;
  hideSplash();
  startApp();
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* تجاهل */ });
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

boot();
