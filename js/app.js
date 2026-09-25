/* ============================================================
   بيتنا — نسخة الويب (PWA)
   نقطة البداية: الهيكل، التنقل، المظهر، والتثبيت
   ============================================================ */

import { $, esc } from './util.js';
import {
  getState, subscribe, update, applyRemote, setCloudBridge, setCloudUid,
  setLogoutHook, setupHousehold, signOut as signOutLocal, uploadLocalData,
  sectionsOf, canSee, amOwner, persistNow,
} from './store.js';
import * as cloud from './cloud.js';
const amHelper = () => cloud.isHelper();
import { route, setNotFound, setOnChange, start, go, back, currentPath } from './router.js';
import { renderAuth } from './screens/auth.js';
import { homeScreen } from './screens/home.js';
import { shoppingScreen, shoppingFormScreen, shoppingDetailsScreen, shoppingSessionScreen, favoriteListScreen } from './screens/shopping.js';
import { faultsScreen, faultFormScreen, faultDetailsScreen } from './screens/faults.js';
import { occasionsScreen, occasionFormScreen, occasionDetailsScreen } from './screens/occasions.js';
import {
  moreScreen, profileScreen, householdScreen, notificationsScreen,
  categoriesScreen, archiveScreen, supportScreen,
  housesScreen, joinHouseScreen,
} from './screens/more.js';
import { controlScreen } from './screens/control.js';
import { pantryScreen } from './screens/pantry.js';
import { emptyState, toast, iosInstallSheet } from './ui.js';
import { startReminderLoop, notifyPartner, isIOS, isStandalone } from './notify.js';
import { helperScreen, langSheet } from './screens/helper.js';
import { refreshPush } from './push.js';
import { t, applyLangToDocument, currentLang, setLang, localizeMainUi, observeMainUi } from './i18n.js';
import { diag } from './diag.js';
import {
  flushPendingPantryImages, syncIncomingPantryImages, syncIncomingShoppingImages,
  syncIncomingFaultImages,
} from './local-images.js';

/* المسار القديم للوحة المدمجة لم يعد موجودًا. إذا بقي في نافذة أو اختصار
   من النسخة السابقة، نعيده للرئيسية بدل إبقاء المستخدم في صفحة مفقودة. */
if (/^#\/admin(?:\/|$)/.test(location.hash)) {
  history.replaceState(null, '', location.pathname + location.search + '#/home');
}

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
  /* ‎?reset=1‎ يمسح الذاكرة المؤقتة فقط فيمرّ مباشرة.
     ‎?reset=all‎ يمحو البيانات والحساب — لا يمرّ إلا بتأكيد صريح،
     وإلا كفى إرسال رابط واحد لأي فرد ليفقد كل ما على جهازه. */
  const go = !all || window.confirm(
    'سيتم محو كل بيانات بيتنا على هذا الجهاز وتسجيل الخروج. '
    + 'إن لم تكن أنت من فتح هذا الرابط بنفسك، اضغط «إلغاء».'
  );
  if (go) {
    wipeEverything(all).finally(() => {
      location.replace(location.origin + location.pathname);
    });
  } else {
    history.replaceState(null, '', location.origin + location.pathname);
  }
}

/* ---------- التنقل السفلي ----------
   الأسماء والأيقونات من لوحة التحكم، وما مُنع عن هذا الفرد لا يظهر له. */
const NAV_ORDER = ['home', 'shopping', 'faults', 'occasions', 'more'];

function navItems() {
  if (amHelper()) return [];          // العاملة شاشتها واحدة بلا شريط
  const s = sectionsOf();
  return NAV_ORDER
    .filter((key) => (key === 'home' || key === 'more') || canSee(key))
    .map((key) => ({ route: '/' + key, label: s[key].label, icon: s[key].icon }));
}

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
  /* إعادة رسم الشاشة نفسها (مزامنة وصلت، أو تبديل حالة) ليست تنقّلًا:
     نُبقي موضع القراءة بدل قذف المستخدم إلى أعلى الصفحة. */
  const sameScreen = factory === currentFactory
    && JSON.stringify(params) === JSON.stringify(currentParams);
  const keepScroll = sameScreen ? (window.scrollY || 0) : 0;

  diag.repaints++;
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

  /* الشاشات تسجّل مستمعاتها على #view نفسه، وهو عنصر ثابت لا يُستبدل
     إلا محتواه — فتتراكم المستمعات رسمةً بعد رسمة ويُنفَّذ الفعل الواحد
     بعددها. نستبدل العقدة كلها فتموت مستمعات الشاشة السابقة معها. */
  const stale = $('#view');
  const view = stale.cloneNode(false);


  /* نملأ العقدة وهي خارج الصفحة ثم نبدّلها دفعة واحدة.
     بالترتيب المعكوس تفرغ الشاشة إطارًا كاملًا قبل أن تمتلئ،
     فيرى المستخدم وميضًا أبيض مع كل رسمة. */
  view.innerHTML = screen.html + (screen.fab
    ? `<button class="fab" data-fab>${esc(screen.fab.label)}</button>` : '');

  stale.replaceWith(view);

  view.scrollTop = 0;
  window.scrollTo({ top: keepScroll });

  screen.mount?.(view, rerender);
  localizeMainUi(document.querySelector('#app'));

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

/* ============================================================
   إعادة الرسم: مشروطة، ولا تقطع على المستخدم عمله

   كانت كل نبضة مزامنة تُعيد رسم الشاشة كاملةً — يُستبدل ‎#view‎،
   فيُفقد تركيز حقل الكتابة ويقفز موضع القراءة، وتبدو الصفحة كأنها
   تُحدِّث نفسها كل ثوانٍ. الآن:
     • لا نرسم إلا إذا تغيّرت البيانات فعلًا (بصمة لكل مجموعة).
     • ولا نرسم وأنت تكتب أو ولوحٌ مفتوح — نؤجّل حتى تفرغ.
   ============================================================ */
let deferred = false;

/** هل المستخدم منشغل بحقل أو لوح مفتوح؟ */
function busy() {
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest('#view')) return true;
  return !!($('#sheetRoot')?.innerHTML || $('#dialogRoot')?.innerHTML);
}

function rerender() {
  if (!currentFactory) return;
  if (busy()) { deferred = true; return; }
  deferred = false;
  render(currentFactory, currentParams);
}

/** يُطلق الرسمة المؤجَّلة متى ما فرغ المستخدم */
function flushDeferred() {
  if (deferred && !busy()) rerender();
}

/* المزامنة تُسلّم كل مجموعة على حدة — مشتريات، أعطال، تذكيرات،
   تصنيفات، قوائم، مخزون، أعضاء — فكانت الشاشة تُبنى من جديد مرة
   لكل واحدة. قياسًا: 10 إلى 12 رسمة عند الإقلاع، ثمانٍ منها في
   المللي ثانية نفسها. هنا نجمعها كلها في رسمة واحدة.
   الرسم بعد فعل المستخدم يبقى فوريًا: الشاشات تعتمد عليه لإعادة
   التركيز إلى حقل البحث بعد كل حرف. */
const COALESCE_MS = 60;    // دون عتبة الإحساس، وفوق تتابع دفعات الإقلاع
const COALESCE_MAX = 250;  // ولا نؤجّل إلى ما لا نهاية إن تتابع الوارد

let timer = 0;
let firstAt = 0;
function scheduleRerender() {
  /* قد تصل الدفعة المحفوظة أثناء استعادة أول جلسة وقبل أول رسم. البيانات
     ستدخل أصلًا في الرسم الأول، فلا نحجز رسمة ثانية بعده مباشرة. */
  if (!booted || !currentFactory) return;
  const t = Date.now();
  if (!timer) firstAt = t;
  else if (t - firstAt > COALESCE_MAX) return;   // المؤقّت القائم سيُطلقها
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; rerender(); }, COALESCE_MS);
}

document.addEventListener('focusout', () => setTimeout(flushDeferred, 0));
for (const id of ['#sheetRoot', '#dialogRoot']) {
  const el = document.querySelector(id);
  if (el) new MutationObserver(() => setTimeout(flushDeferred, 0)).observe(el, { childList: true });
}

/* ---------- شريط التنقل ---------- */
/* صندوق الأيقونة ثابت 28×28 ولا تحويل عند التفعيل، فالإيموجي لا يقفز.
   كانت القفزة من transform على ‎.navitem.active .ic‎ وقد أُزيل، فلا داعي
   لاستبدال الجرس برسمة خطّية تشذّ عن بقية الأيقونات الملوّنة. */
function navHtml(withBrand, items) {
  return (withBrand ? `<div class="brand"><span class="logo">🏡</span> بيتنا</div>` : '') +
    items.map((n) => `
      <button class="navitem" data-go="${n.route}">
        <span class="ic">${esc(n.icon)}</span><span>${esc(n.label)}</span>
      </button>`).join('');
}

let paintedNavKey = '';
function paintNav() {
  const helper = amHelper();
  const items = helper ? [] : navItems();
  const key = JSON.stringify([currentLang(), items]);
  const bottom = $('#bottomnav');
  const side = $('#sidenav');

  /* لا نستبدل أزرار الشريط مع كل رسمة أو أثناء الضغطة. نعيد بناءه فقط
     إذا تغيرت عناصره فعلًا (صلاحية/اسم/أيقونة)، ثم نبدّل active محليًا. */
  if (key !== paintedNavKey) {
    bottom.innerHTML = helper ? '' : navHtml(false, items);
    side.innerHTML = helper ? '' : navHtml(true, items);
    paintedNavKey = key;
  }

  const path = currentPath();
  const root = '/' + (path.split('/')[1] || 'home');
  for (const nav of [bottom, side]) {
    nav.querySelectorAll('.navitem').forEach((item) => {
      item.classList.toggle('active', item.dataset.go === root);
    });
  }

  bottom.hidden = helper;
  side.hidden = helper;
  document.body.classList.toggle('helper-mode', helper);
  if (!helper) localizeMainUi(document.querySelector('#app'));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && b.closest('#bottomnav, #sidenav')) go(b.dataset.go);
});

/* ---------- المسارات ---------- */
route('/helper', () => render(helperScreen));

/** حارس: العاملة لا تصل إلا شاشتها مهما كان المسار */
function guarded(factory) {
  return (p) => {
    if (amHelper()) return render(helperScreen);
    /* اللغات الإضافية لمسار العاملة فقط؛ واجهة الأسرة عربية/إنجليزية. */
    if (!['ar', 'en'].includes(currentLang())) setLang('ar');
    return render(factory, p);
  };
}

route('/home', guarded(homeScreen));

route('/shopping', guarded(shoppingScreen));
route('/shopping/new', guarded(shoppingFormScreen));
route('/shopping/session', guarded(shoppingSessionScreen));
route('/shopping/list/:id', guarded(favoriteListScreen));
route('/pantry', guarded(pantryScreen));
route('/shopping/:id', guarded(shoppingDetailsScreen));

route('/faults', guarded(faultsScreen));
route('/faults/new', guarded(faultFormScreen));
route('/faults/:id', guarded(faultDetailsScreen));

route('/occasions', guarded(occasionsScreen));
route('/occasions/new', guarded(occasionFormScreen));
route('/occasions/:id', guarded(occasionDetailsScreen));

route('/more', guarded(moreScreen));
route('/profile', guarded(profileScreen));
route('/household', guarded(householdScreen));
route('/houses', guarded(housesScreen));
route('/join-house', guarded(joinHouseScreen));
route('/notifications', guarded(notificationsScreen));
route('/categories', guarded(categoriesScreen));
route('/control', guarded(controlScreen));
route('/archive', guarded(archiveScreen));
route('/support', guarded(supportScreen));

setNotFound(() => render(() => ({
  title: 'الصفحة غير موجودة',
  back: true,
  html: emptyState('🧭', 'لم نجد هذه الصفحة', 'ارجع للرئيسية وواصل من هناك'),
})));

setOnChange(applyTheme);

/* ============================================================
   جلسة السحابة
   ============================================================ */
/** بصمة آخر ما وصل من كل مجموعة — لا نعيد الرسم على بيانات لم تتغيّر */
const lastSig = new Map();
function collectionChanged(col, items) {
  let sig;
  try { sig = JSON.stringify(items); } catch { return true; }
  if (lastSig.get(col) === sig) return false;
  lastSig.set(col, sig);
  return true;
}

function cloudBridge(hid) {
  return {
    save: (col, item) => cloud.saveItem(hid, col, item),
    patch: (col, id, patch) => cloud.patchItem(hid, col, id, patch),
    act: (col, id, act, patch) => cloud.actItem(hid, col, id, act, patch),
    remove: (col, id) => cloud.removeItem(hid, col, id),
    profile: (_, patch) => cloud.updateMemberProfile(hid, patch),
    removeMember: (_, uid) => cloud.removeMemberCloud(hid, uid),
    prefs: (_, prefs) => cloud.saveNotificationPrefs(prefs),
  };
}

let imageRelayTimer = 0;
async function syncImageRelay() {
  try {
    await flushPendingPantryImages();
    if (cloud.isOwner()) {
      const received = await syncIncomingPantryImages()
        + await syncIncomingShoppingImages() + await syncIncomingFaultImages();
      if (received) scheduleRerender();
    }
  } catch { /* الشبكة أو الجلسة ستُعاد محاولتها في الدورة التالية */ }
}

function startImageRelay() {
  clearInterval(imageRelayTimer);
  syncImageRelay();
  imageRelayTimer = setInterval(syncImageRelay, 20000);
}

function startCloudSession(hid) {
  setCloudUid(cloud.currentUid());
  setCloudBridge(cloudBridge(hid), hid);

  cloud.startSync(hid, {
    onData(col, items) {
      /* الخادم يبثّ ما لديه في كل نبضة، وصدى كتابتي يعود إليّ كما هو.
         بلا هذه المقارنة تُعاد رسمة كاملة كل ست ثوانٍ بلا جديد. */
      if (!collectionChanged(col, items)) { diag.skipped++; return; }

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
      } else if (col === 'ui') {
        /* تخصيص الأقسام من لوحة تحكم المالك */
        update((st) => { st.ui = items || { sections: {} }; });
      } else if (col === 'caps') {
        /* صلاحياتي كما يراها الخادم — الواجهة تُخفي، والخادم يمنع */
        update((st) => { st.caps = items; });
      } else if (col === 'household') {
        update((st) => {
          if (items.name) st.household.name = items.name;
          /* القيمة الفارغة مقصودة عند الإلغاء أو عند غياب صلاحية الدعوة. */
          st.household.inviteCode = items.inviteCode || '';
        });
      } else if (col === 'categories' && items.length === 0) {
        /* لا نفرّغ التصنيفات إن لم تصل من السحابة — نبقي الافتراضية */
      } else {
        applyRemote(col, items);
      }
      scheduleRerender();
    },
    onPartnerActivity(text) {
      notifyPartner(text);
      toast(text);
    },
    onSessionEnded() {
      /* حذف المالك للعاملة يحذف حسابها على الخادم. أول نبضة مزامنة
         تُسقط الجلسة محليًا أيضًا، فلا تبقى شاشة قديمة مفتوحة عندها. */
      signOutLocal();
      persistNow();
      location.replace(location.origin + location.pathname);
    },
  });

  startImageRelay();

  cloud.recordSession();
  flushPendingUpload();
  /* الاشتراكات تنتهي أحيانًا من تلقائها — نجدّدها بصمت لمن فعّلها */
  refreshPush();
}

/** يرفع بيانات جهاز كان يعمل بلا حساب، بعد ربطه بحساب سحابي */
function flushPendingUpload() {
  let pending = false;
  try { pending = localStorage.getItem('beitna:pending-upload') === '1'; } catch { /* تجاهل */ }
  if (!pending) return;
  try { localStorage.removeItem('beitna:pending-upload'); } catch { /* تجاهل */ }
  /* نمهل المزامنة الأولى حتى لا تُطمَس الرفعة بردّ الخادم */
  setTimeout(() => {
    const n = uploadLocalData();
    if (n) toast(`رُفع ${n} عنصرًا من هذا الجهاز إلى بيتك ✓`, 4000);
  }, 2500);
}

cloud.setWriteErrorHandler?.((msg) => toast(msg, 4000));

setLogoutHook(() => {
  clearInterval(imageRelayTimer); imageRelayTimer = 0;
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
  applyLangToDocument();
  applyTheme();
  failsafe();
  await cloud.initCloud();
  cloud.purgeLegacy?.();
  const s = getState();

  /* ===== انتهت الجلسة (أو تغيّر الخادم): نعيده لشاشة الدخول بدل حالة معلّقة ===== */
  if (s.onboarded && s.household?.cloud && !cloud.hasSession?.()) {
    signOutLocal();
    showApp();
    return;
  }

  /* ===== مُهيّأ مسبقًا: نعرض آخر بيانات محفوظة فورًا، والمزامنة تلحق لاحقًا ===== */
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
    const prefs = await cloud.loadNotificationPrefs();
    if (prefs?.language) setLang(prefs.language);
    setupHousehold({
      householdName: hh?.name || getState().household.name || t('app_name'),
      memberName: user.displayName || getState().profile.name || (user.email || '').split('@')[0],
      email: user.email || '',
      inviteCode: hh?.inviteCode || '',
      isOwner: cloud.isOwner(),
      cloud: true,
    });

    startCloudSession(hid);
    if (!booted) showApp();
    else scheduleRerender();
    return true;
  } catch (e) {
    console.warn('تعذّرت استعادة الجلسة السحابية', e);
    return false;
  }
}

function startApp() {
  $('#authRoot').hidden = true;
  paintNav();
  /* العاملة تُفتح على شاشتها مباشرة مهما كان المسار المحفوظ */
  if (amHelper() && !location.hash.startsWith('#/helper')) {
    history.replaceState(null, '', '#/helper');
  }
  start();
  /* العاملة لا ترى التذكيرات ولا تتلقى ملخص الأسرة؛ يصلها فقط نشاط
     المشتريات والأعطال المسموح لها به ومن خلال لغتها المختارة. */
  if (!amHelper()) startReminderLoop();
  subscribe(applyTheme);
  maybeShowInstall();
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
  /* لا نعتمد على controllerchange لأنه قد يتكرر عند الرجوع من الخلفية.
     عامل الخدمة نفسه يرسل app-update مرة واحدة بعد اكتمال تفعيل إصدار
     جديد، وعندها فقط نعيد التحميل كي يصل التحديث للأجهزة المفتوحة. */

  /* الضغط على الإشعار: الـ Service Worker يركّز النافذة ويرسل لنا الوجهة */
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'app-update') {
      location.reload();
      return;
    }
    if (e.data?.type === 'notification-click') {
      const hash = String(e.data.url || '').split('#')[1];
      if (hash) go('/' + hash.replace(/^\/+/, ''));
    }
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

/* ============================================================
   التثبيت على الجهاز
   أندرويد: يعطي المتصفح حدث beforeinstallprompt.
   iPhone: لا يوجد حدث إطلاقًا — نعرض خطوات «إضافة إلى الشاشة الرئيسية».
   الشريط يُرسم في ‎#installRoot‎ لأن ‎#view‎ يُمسح مع كل إعادة رسم.
   ============================================================ */
const INSTALL_DISMISS_KEY = 'beitna:install-dismissed';
let deferredPrompt = null;
let installShown = false;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  maybeShowInstall();
});

/* الشريط كان يظهر متحركًا عند 338ms — في وسط انكشاف السبلاش تمامًا،
   فيضيف حركةً ثانية إلى لحظة الفتح. نؤخّره حتى تستقرّ الواجهة، وهو
   أفضل أصلًا: لا نطلب التثبيت قبل أن يرى المستخدم شيئًا. */
const INSTALL_DELAY_MS = 3000;
let installTimer = 0;

/** يعرض الشريط متى ما صار ذلك ممكنًا — يُستدعى عند الحدث وبعد ظهور الواجهة */
function maybeShowInstall() {
  if (installShown || !booted) return;
  if (isStandalone()) return;                                   // مثبّت بالفعل
  try { if (localStorage.getItem(INSTALL_DISMISS_KEY)) return; } catch { /* تجاهل */ }

  /* على iOS لا يوجد زر تثبيت تلقائي إطلاقًا — الخطوات اليدوية هي الطريق الوحيد */
  const iosMode = isIOS();
  if (!deferredPrompt && !iosMode) return;                      // لا طريقة تثبيت معروفة
  clearTimeout(installTimer);
  installTimer = setTimeout(() => {
    if (installShown || isStandalone()) return;
    renderInstallBar(iosMode);
  }, INSTALL_DELAY_MS);
}

function renderInstallBar(iosMode) {
  const root = $('#installRoot');
  if (!root) return;
  installShown = true;
  root.hidden = false;
  root.innerHTML = `
    <div class="install-bar">
      <span style="font-size:22px">📲</span>
      <div class="grow">
        <div class="strong small">${esc(t('install_title'))}</div>
        <div class="tiny muted">${esc(iosMode ? t('install_ios') : t('install_hint'))}</div>
      </div>
      <button class="btn sm" data-install>${esc(t('install'))}</button>
      <button class="icon-btn" data-dismiss aria-label="${esc(t('cancel'))}">✕</button>
    </div>`;

  root.querySelector('[data-install]').onclick = async () => {
    if (iosMode) { iosInstallSheet(); return; }
    const evt = deferredPrompt;
    if (!evt) return;
    deferredPrompt = null;
    evt.prompt();
    const res = await evt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    hideInstallBar();
    if (res.outcome !== 'accepted') toast(t('install_later'));
  };
  root.querySelector('[data-dismiss]').onclick = () => {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* تجاهل */ }
    hideInstallBar();
  };
}

function hideInstallBar() {
  clearTimeout(installTimer);
  const root = $('#installRoot');
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  installShown = false;
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  hideInstallBar();
  try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch { /* تجاهل */ }
  toast(t('installed'));
});

/* ---------- حالة الاتصال ---------- */
window.addEventListener('offline', () => toast(t('offline')));

/* ---------- التشغيل ---------- */
observeMainUi();
boot().catch((e) => {
  console.error('فشل الإقلاع', e);
  try { showApp(); } catch (e2) {
    document.getElementById('splash')?.remove();
    /* مسار العطل التام: نبنيه عقدةً عقدة بلا onclick مضمَّن — يمنعه CSP،
       وهذه آخر شاشة يراها المستخدم فلا يجوز أن يتعطّل زرّها. */
    document.body.textContent = '';
    const box = document.createElement('div');
    box.setAttribute('style', 'padding:32px;text-align:center;font-family:Tajawal,system-ui');
    const mark = document.createElement('div');
    mark.setAttribute('style', 'font-size:44px');
    mark.textContent = '⚠️';
    const head = document.createElement('h2');
    head.setAttribute('style', 'margin:8px 0');
    head.textContent = t('startup_error');
    const note = document.createElement('p');
    note.setAttribute('style', 'color:#6B7280');
    note.textContent = t('startup_retry');
    const btn = document.createElement('button');
    btn.setAttribute('style', 'padding:12px 22px;border-radius:999px;background:#0F8B6D;color:#fff;font-weight:700;border:0');
    btn.textContent = t('reset_refresh');
    btn.addEventListener('click', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      } catch { /* نُحدّث على أي حال */ }
      location.reload();
    });
    box.append(mark, head, note, btn);
    document.body.appendChild(box);
  }
});

