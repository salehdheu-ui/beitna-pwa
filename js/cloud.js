/* ============================================================
   طبقة السحابة — خادم "بيتنا" الخاص بك
   مستضاف على خادمك أنت. لا Firebase ولا أي طرف خارجي.
   يعمل بدون إنترنت: كل شيء محفوظ محليًا، والتغييرات
   تُرسل تلقائيًا أول ما يعود الاتصال.
   ============================================================ */

import { t, localizedText } from './i18n.js';

/* ============================================================
   عنوان الخادم
   كان يُشتق من مكان فتح الصفحة (location.origin + '/api')، فأي نسخة
   لا تُفتح من دومين الخادم نفسه — نسخة محلية، دومين ثانٍ، WebView —
   كانت تخاطب خادمًا ثابتًا لا وجود لـ /api فيه، فيرد 501/405،
   ويبقى ذلك الجهاز جزيرة لا تتزامن مع بقية الأجهزة.

   الآن: نستخدم /api على نفس الأصل إن كان يستجيب فعلًا (لا CORS،
   ويحترم النسخ المستضافة ذاتيًا)، وإلا نرجع لخادم بيتنا الرسمي
   حتى يبقى الحساب واحدًا من أي مكان.
   ============================================================ */
const CANONICAL_API = 'https://beitna.saher.cloud/api';
const K_API = 'beitna:api';

const trimSlash = (u) => String(u).replace(/\/+$/, '');

/** عنوان مفروض يدويًا: window.BEITNA_API أو مفتاح محفوظ (للنسخ المستضافة ذاتيًا) */
function forcedApi() {
  if (window.BEITNA_API) return trimSlash(window.BEITNA_API);
  try {
    const saved = localStorage.getItem(K_API);
    if (saved) return trimSlash(saved);
  } catch { /* تجاهل */ }
  return null;
}

/** هل يوجد خادم بيتنا فعلًا على هذا العنوان؟ */
async function isBeitnaServer(base) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(base + '/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.ok === true;
  } catch { return false; }
}

const K_API_CACHE = 'beitna:api:resolved';
const API_CACHE_MS = 7 * 86400000;

/** نتيجة اكتشاف سابقة على نفس الأصل — تمنع تكرار الفحص كل تشغيل */
function cachedApi() {
  try {
    const c = JSON.parse(localStorage.getItem(K_API_CACHE) || 'null');
    if (!c || c.origin !== location.origin) return null;
    if (Date.now() - (c.at || 0) > API_CACHE_MS) return null;
    return c.base || null;
  } catch { return null; }
}
function rememberApi(base) {
  try {
    localStorage.setItem(K_API_CACHE, JSON.stringify({ origin: location.origin, base, at: Date.now() }));
  } catch { /* تجاهل */ }
}

let API = forcedApi() || cachedApi() || CANONICAL_API;
let apiPromise = null;

/** يحدّد عنوان الخادم مرة واحدة. لا يُستدعى أثناء الإقلاع — فقط عند أول طلب. */
function detectApi() {
  if (apiPromise) return apiPromise;
  const forced = forcedApi();
  if (forced) { API = forced; apiPromise = Promise.resolve(API); return apiPromise; }

  apiPromise = (async () => {
    const sameOrigin = trimSlash(location.origin + '/api');
    if (location.origin === new URL(CANONICAL_API).origin) return (API = sameOrigin);

    const remembered = cachedApi();
    if (remembered) return (API = remembered);

    const base = (/^https?:$/.test(location.protocol) && await isBeitnaServer(sameOrigin))
      ? sameOrigin
      : CANONICAL_API;
    rememberApi(base);
    return (API = base);
  })();
  return apiPromise;
}

/** العنوان المستخدم فعلًا — تعرضه شاشة الدعم */
export const apiBase = () => API;
export const canonicalApi = () => CANONICAL_API;

/** يفحص الخادم المستخدم حاليًا ويرجع تفاصيله (لزر «فحص الاتصال») */
export async function checkServer({ rediscover = false } = {}) {
  if (rediscover) {
    try { localStorage.removeItem(K_API_CACHE); } catch { /* تجاهل */ }
    apiPromise = null;
  }
  await detectApi();
  const ok = await isBeitnaServer(API);
  return { base: API, ok, canonical: API === CANONICAL_API };
}

const K_TOKEN = 'beitna:token';
const K_USER = 'beitna:user';
const K_DOCS = (hid) => 'beitna:docs:' + hid;
const K_QUEUE = 'beitna:queue';

const POLL_MS = 6000;

/* ---------- الحالة ---------- */
let token = null;
let me = null;              // { uid, email, displayName, householdId }
let ready = false;
let onWriteError = null;
let hidActive = null;
let docs = {};              // { col: { id: doc } }
let membersMap = {};
let cursor = 0;
let pollTimer = null;
let listeners = null;
let firstEmit = true;
let selfWrites = new Set();
let flushing = false;
let lastUiSig = null;       // بصمة آخر تخصيص أقسام مُمرَّر
let lastCapsSig = null;     // وبصمة آخر صلاحيات — نمنع رسمةً بلا تغيير

export function setWriteErrorHandler(fn) { onWriteError = fn; }

/** هل توجد جلسة محفوظة على هذا الجهاز؟ */
export function hasSession() {
  try { return !!localStorage.getItem(K_TOKEN); } catch { return false; }
}

/** ينظّف بقايا مزوّد المصادقة السابق (مرة واحدة) */
export function purgeLegacy() {
  try {
    Object.keys(localStorage)
      .filter((k) => /^firebase[:_]/i.test(k) || k.startsWith('firebaseLocalStorage'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* تجاهل */ }
  try {
    indexedDB.databases?.().then((list) => {
      (list || []).forEach((d) => {
        if (d.name && /firebase|firestore/i.test(d.name)) indexedDB.deleteDatabase(d.name);
      });
    }).catch(() => {});
  } catch { /* تجاهل */ }
}
export const isReady = () => ready;
export const currentUid = () => me?.uid || null;
export const currentEmail = () => me?.email || null;

/* ---------- تخزين محلي آمن ---------- */
function lsGet(k, fallback = null) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ممتلئ */ }
}
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* تجاهل */ } }

/* ---------- طلب شبكة بمهلة ---------- */
async function req(pathname, { method = 'GET', body, timeout = 15000, auth = true } = {}) {
  await detectApi();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { 'content-type': 'application/json' };
    if (auth && token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(API + pathname, {
      method, headers, signal: ctrl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const e = new Error(data?.error || 'http-' + res.status);
      e.code = data?.error || 'http-' + res.status;
      e.status = res.status;
      throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('auth-timeout'); x.code = 'auth-timeout'; throw x; }
    if (e.status) throw e;
    if (!navigator.onLine) { const x = new Error('offline'); x.code = 'offline'; throw x; }
    const x = new Error('network'); x.code = 'network'; throw x;
  } finally { clearTimeout(t); }
}

/* ---------- التهيئة ---------- */
export async function initCloud() {
  if (ready) return true;
  token = lsGet(K_TOKEN);
  me = lsGet(K_USER);
  ready = true;
  return true;      // لا شبكة هنا إطلاقًا — التطبيق يفتح فورًا
}

/** يرجع المستخدم المحفوظ فورًا (بدون انتظار الشبكة) */
export async function waitForUser() {
  if (!ready) await initCloud();
  if (!token || !me) return null;
  /* تحديث صامت من الخادم إن توفّر الاتصال */
  req('/me', { timeout: 8000 }).then((u) => {
    me = { uid: u.uid, email: u.email, displayName: u.displayName, householdId: u.householdId };
    setPerm(u.perm);
    lsSet(K_USER, me);
  }).catch((e) => {
    if (e.code === 'no-user') { /* انتهت الجلسة */ token = null; me = null; lsDel(K_TOKEN); lsDel(K_USER); }
  });
  return me;
}

/** يحذف الحساب من الخادم نهائيًا. يتطلب كلمة المرور. */
export async function deleteAccount(password) {
  const r = await req('/account/delete', { method: 'POST', body: { password }, timeout: 20000 });
  /* الحساب زال من الخادم — لا يجوز أن تبقى نسخة من بيانات البيت على الجهاز */
  await signOutCloud();
  return r;
}

/** إحصائيات النظام — تنجح للمشرفين فقط */
export function loadStats() {
  return req('/stats', { timeout: 15000 });
}

/** هل هذا الحساب مشرف؟ يُقرأ من /me */
export async function amAdmin() {
  try { const u = await req('/me', { timeout: 8000 }); return !!u.isAdmin; }
  catch { return false; }
}

/* ---------- رسائل الأخطاء ---------- */
export function arabicError(e) {
  const code = String(e?.code || e?.message || '');
  /* رسالة واحدة للبريد وكلمة المرور معًا: التفريق بينهما يكشف من يملك
     حسابًا عندنا لمن يجرّب البُرد واحدًا واحدًا. */
  if (code.includes('invalid-credentials')) return t('err_credentials');
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return t('err_credentials');
  if (code.includes('user-not-found')) return t('err_credentials');
  if (code.includes('email-already-in-use')) return t('err_email_used');
  if (code.includes('invalid-email')) return t('err_invalid_email');
  if (code.includes('weak-password')) return t('password_short');
  if (code.includes('too-many-requests')) return t('err_many_requests');
  if (code.includes('bad-code')) return t('invalid_invite');
  if (code.includes('offline')) return t('err_online_required');
  if (code.includes('auth-timeout')) return t('err_timeout');
  if (/http-(404|405|501)/.test(code)) return t('err_server');
  if (/http-(500|502|503|504)/.test(code)) return t('err_server');
  if (code.includes('network')) return t('err_online_required');
  if (code.includes('no-user')) return t('err_session');
  if (code.includes('no-household')) return t('err_no_home');
  if (code.includes('owner-only')) return t('err_owner_only');
  if (code.includes('admin-only')) return 'هذه الشاشة للمشرف فقط';
  if (code.includes('no-subscription')) return 'لم تُفعّل الإشعارات الخلفية على هذا الجهاز بعد';
  if (code.includes('bad-subscription')) return 'بيانات الاشتراك غير صحيحة';
  if (code.includes('bad-recovery')) return t('err_bad_recovery');
  if (code.includes('backup-failed')) return 'تعذّرت النسخة الاحتياطية — راجع سجل الخادم';
  if (code.includes('not-a-member')) return t('err_not_member');
  return `${t('err_generic')}: ${code}`;
}

/* ---------- الحساب ---------- */
function keepSession(u) {
  token = u.token;
  me = { uid: u.uid, email: u.email, displayName: u.displayName, householdId: u.householdId || null };
  lsSet(K_TOKEN, token);
  lsSet(K_USER, me);
  return me;
}

export async function signIn(email, password) {
  const u = await req('/login', { method: 'POST', auth: false, body: { email, password } });
  return keepSession(u);
}

export async function signUp(email, password, displayName) {
  const u = await req('/signup', { method: 'POST', auth: false, body: { email, password, displayName } });
  const session = keepSession(u);
  /* رمز الاسترداد يصل مرة واحدة فقط — نمرّره للواجهة لتعرضه */
  return { ...session, recoveryCode: u.recoveryCode };
}

/** يمسح كل ما خزّنته السحابة على هذا الجهاز — بما فيه ذاكرة أي بيت سابق */
function purgeLocalCloudCache() {
  lsDel(K_TOKEN); lsDel(K_USER); lsDel(K_QUEUE);
  myPerm = 'member';
  try { localStorage.removeItem(K_PERM); } catch { /* تجاهل */ }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('beitna:docs:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* تجاهل */ }
}

export async function signOutCloud() {
  stopSync();
  token = null; me = null; hidActive = null; docs = {}; membersMap = {}; cursor = 0;
  purgeLocalCloudCache();
}

/* ---------- البيت ---------- */
export async function loadHouseholdId() {
  if (me?.householdId) return me.householdId;
  try {
    const u = await req('/me', { timeout: 10000 });
    me = { uid: u.uid, email: u.email, displayName: u.displayName, householdId: u.householdId };
    lsSet(K_USER, me);
    return me.householdId || null;
  } catch { return me?.householdId || null; }
}

export async function createHousehold(name, memberName) {
  const hh = await req('/household', { method: 'POST', body: { name, memberName } });
  setPerm('owner');
  if (me) { me.householdId = hh.id; me.displayName = memberName || me.displayName; lsSet(K_USER, me); }
  return hh;
}

export async function joinHousehold(code, memberName) {
  const hh = await req('/household/join', { method: 'POST', body: { code, memberName } });
  setPerm(hh.perm);
  if (me) { me.householdId = hh.id; me.displayName = memberName || me.displayName; lsSet(K_USER, me); }
  return hh;
}

export async function loadHousehold(hid) {
  try {
    const hh = await req('/household', { timeout: 10000 });
    setPerm(hh.perm);
    return hh;
  } catch {
    const cached = lsGet(K_DOCS(hid));
    return cached?.household || null;
  }
}

/* ============================================================
   المزامنة
   ============================================================ */
const MAPPERS = {
  shopping: (d) => ({
    id: Number(d.id), name: d.name || '', quantity: d.quantity || '',
    category: d.category || '', priority: d.priority || 'عادي', note: d.note || '',
    sourceLang: d.sourceLang || '', translations: d.translations && typeof d.translations === 'object' ? d.translations : {},
    status: d.status || 'ناقص', owner: d.owner || '', ownerUid: d.ownerUid || '',
    price: d.price || '', priceValue: Number(d.priceValue) || 0,
    createdAt: Number(d.createdAt) || Date.now(), purchasedAt: d.purchasedAt || 0,
    createdBy: d.createdBy || '', claimedBy: d.claimedBy || '', claimedAt: Number(d.claimedAt) || 0,
    doneBy: d.doneBy || '', doneAt: Number(d.doneAt) || 0, trail: Array.isArray(d.trail) ? d.trail : [],
  }),
  faults: (d) => ({
    id: Number(d.id), title: d.title || '', location: d.location || '',
    priority: d.priority || 'متوسط', status: d.status || 'جديد', note: d.note || '',
    sourceLang: d.sourceLang || '', translations: d.translations && typeof d.translations === 'object' ? d.translations : {},
    linkedItems: d.linkedItems || [], photoUrl: d.photoUrl || '', ownerUid: d.ownerUid || '',
    estimatedCost: Number(d.estimatedCost) || 0, actualCost: Number(d.actualCost) || 0,
    technician: d.technician || '', repairDate: Number(d.repairDate) || 0,
    createdAt: Number(d.createdAt) || Date.now(),
    createdBy: d.createdBy || '', claimedBy: d.claimedBy || '', claimedAt: Number(d.claimedAt) || 0,
    doneBy: d.doneBy || '', doneAt: Number(d.doneAt) || 0, trail: Array.isArray(d.trail) ? d.trail : [],
  }),
  occasions: (d) => ({
    id: Number(d.id), title: d.title || '', type: d.type || 'مناسبة عامة',
    date: d.date || '', dateMillis: Number(d.dateMillis) || Date.now(),
    reminder: d.reminder || '', note: d.note || '', linkedItems: d.linkedItems || [],
    createdBy: d.createdBy || '', claimedBy: d.claimedBy || '', claimedAt: Number(d.claimedAt) || 0,
    doneBy: d.doneBy || '', doneAt: Number(d.doneAt) || 0, trail: Array.isArray(d.trail) ? d.trail : [],
    recurring: d.recurring || 'بدون', reminderTime: d.reminderTime || '09:00',
    reminderOffsets: d.reminderOffsets || [], done: !!d.done,
    createdAt: Number(d.createdAt) || Date.now(),
  }),
  categories: (d) => ({ id: Number(d.id), name: d.name || '', icon: d.icon || '📦', type: d.type || 'Shopping' }),
  favoriteLists: (d) => ({ id: Number(d.id), name: d.name || '', icon: d.icon || '⭐', items: d.items || [] }),
  pantry: (d) => ({
    id: Number(d.id), name: d.name || '', cat: d.cat || 'canned', stocked: d.stocked !== false,
    sourceLang: d.sourceLang || '', translations: d.translations && typeof d.translations === 'object' ? d.translations : {},
  }),
  pantryCategories: (d) => ({
    id: String(d.id || ''), name: String(d.name || '').slice(0, 40),
    icon: String(d.icon || '📦').slice(0, 8), createdAt: Number(d.createdAt) || Date.now(),
    sourceLang: d.sourceLang || '', translations: d.translations && typeof d.translations === 'object' ? d.translations : {},
  }),
};

const LABELS = {
  shopping: (x) => `🛒 ${t('add_item')}: ${localizedText(x, 'name')}`,
  faults: (x) => `🔧 ${t('report_fault')}: ${localizedText(x, 'title')}`,
  occasions: (x) => `🔔 ${t('add')}: ${x.title}`,
};

const COLS = ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists', 'pantry', 'pantryCategories'];

function persistDocs() {
  if (!hidActive) return;
  lsSet(K_DOCS(hidActive), { cursor, docs, members: membersMap });
}

function shapeMembers() {
  return Object.values(membersMap)
    .filter((m) => !m.deleted)
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
    .map((m, i) => ({
      id: i + 1, uid: m.uid, name: m.name || 'عضو', role: m.role || 'عضو',
      phone: m.phone || '', email: m.email || '',
      perm: m.perm || (m.isOwner ? 'owner' : 'member'),
      caps: m.caps && typeof m.caps === 'object' ? { ...m.caps } : {},
      isOwner: !!m.isOwner, isOnline: m.uid === currentUid(), joinedAt: m.joinedAt || 0,
    }));
}

function emit(col) {
  const bucket = docs[col] || {};
  const items = [];
  for (const k of Object.keys(bucket)) {
    const d = bucket[k];
    if (d.deleted) continue;
    try { items.push(MAPPERS[col](d)); } catch { /* مستند تالف */ }
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  listeners?.onData?.(col, items);
}

function emitAll() {
  COLS.forEach(emit);
  listeners?.onData?.('members', shapeMembers());
}

export function startSync(hid, { onData, onPartnerActivity, onSessionEnded }) {
  stopSync();
  hidActive = hid;
  listeners = { onData, onPartnerActivity, onSessionEnded };
  firstEmit = true;

  /* 1) البيانات المحفوظة تظهر فورًا — حتى بدون إنترنت */
  const cached = lsGet(K_DOCS(hid));
  docs = cached?.docs || {};
  membersMap = cached?.members || {};
  cursor = cached?.cursor || 0;
  COLS.forEach((c) => { if (!docs[c]) docs[c] = {}; });
  if (cached) emitAll();

  /* 2) ثم اللحاق بآخر تحديث من الخادم */
  tick();
  pollTimer = setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', onWake);
}

function onWake() { if (!document.hidden && navigator.onLine) tick(); }

export function stopSync() {
  clearInterval(pollTimer); pollTimer = null;
  window.removeEventListener('online', onWake);
  document.removeEventListener('visibilitychange', onWake);
  listeners = null;
}

let ticking = false;
async function tick() {
  if (ticking || !hidActive || !token) return;
  ticking = true;
  try {
    await flushQueue();
    const res = await req('/sync?since=' + cursor, { timeout: 12000 });
    applySync(res);
  } catch (e) {
    if (e.code === 'no-user' || e.code === 'no-household') {
      const ended = listeners?.onSessionEnded;
      stopSync();
      ended?.(e.code);
    }
  } finally { ticking = false; }
}

/** عدّاد نبضات المزامنة — يُقرأ من «الدعم ← حالة التطبيق» */
export const syncStats = { ticks: 0, lastAt: 0 };

function applySync(res) {
  syncStats.ticks++; syncStats.lastAt = Date.now();
  const wasFirst = firstEmit;
  let changed = false;
  const fresh = [];

  for (const col of COLS) {
    const list = res.cols?.[col] || [];
    if (!list.length) continue;
    const bucket = docs[col] || (docs[col] = {});
    for (const d of list) {
      const id = String(d.id);
      const prev = bucket[id];
      if (prev && (prev.updatedAt || 0) > (d.updatedAt || 0)) continue;  // تعديل محلي أحدث
      const isNew = !prev && !d.deleted;
      bucket[id] = d;
      changed = true;
      if (isNew && !wasFirst && LABELS[col] && !selfWrites.has(col + ':' + id)) {
        try { fresh.push([col, MAPPERS[col](d)]); } catch { /* تجاهل */ }
      }
    }
    emit(col);
  }

  if (res.members?.length) {
    for (const m of res.members) membersMap[m.uid] = m;
    changed = true;
    listeners?.onData?.('members', shapeMembers());
  }

  /* تخصيص الأقسام وصلاحياتي يصلان مع كل نبضة مزامنة (كل 6 ثوانٍ).
     لا نمرّرهما إلا إذا تغيّرا فعلًا: تمريرهما بلا تغيير يكتب في الحالة
     فتُطلق رسمة كاملة للشاشة كل نبضة، فتقفز الصفحة للأعلى وتبدو
     كأنها تُحدِّث نفسها. */
  if (res.household && 'ui' in res.household) {
    const sig = JSON.stringify(res.household.ui || null);
    if (sig !== lastUiSig) { lastUiSig = sig; listeners?.onData?.('ui', res.household.ui); }
  }
  if (res.household) {
    listeners?.onData?.('household', {
      name: res.household.name || '',
      inviteCode: res.household.inviteCode || '',
    });
  }
  if (res.caps) {
    const sig = JSON.stringify(res.caps);
    if (sig !== lastCapsSig) { lastCapsSig = sig; listeners?.onData?.('caps', res.caps); }
  }

  cursor = res.now || cursor;
  if (changed || res.full) persistDocs();
  firstEmit = false;

  notifyFresh(fresh);
}

/**
 * إشعار واحد لكل دفعة مزامنة، لا إشعار لكل عنصر.
 * إضافة قائمة كاملة، أو رفع طابور تراكم بلا إنترنت، كانت تصل
 * كعشرات المستندات الجديدة في مزامنة واحدة فتُطلق عشرات الإشعارات.
 */
function notifyFresh(fresh) {
  const mine = currentUid();
  const others = fresh.filter(([, x]) => !(x.ownerUid && x.ownerUid === mine));
  if (!others.length) return;

  if (others.length === 1) {
    const [col, x] = others[0];
    listeners?.onPartnerActivity?.(LABELS[col](x), 1);
    return;
  }

  const n = others.length;
  const text = `🏡 ${t('add')}: ${n}`;
  listeners?.onPartnerActivity?.(text, n);
}

/* ============================================================
   الكتابة — محلية فورًا، ثم تُرسل متى توفّر الاتصال
   ============================================================ */
function mark(col, id) {
  const key = col + ':' + id;
  selfWrites.add(key);
  setTimeout(() => selfWrites.delete(key), 60000);
}

function enqueue(op) {
  const q = lsGet(K_QUEUE, []);
  /* عملية أحدث على نفس العنصر تلغي "الدمج" السابق لتقليل الطابور */
  q.push(op);
  lsSet(K_QUEUE, q.slice(-800));
  flushQueue();
}

async function flushQueue() {
  if (flushing || !token || !navigator.onLine) return;
  let q = lsGet(K_QUEUE, []);
  if (!q.length) return;
  flushing = true;
  try {
    while (q.length) {
      const batch = q.slice(0, 200);
      await req('/write', { method: 'POST', body: { ops: batch }, timeout: 20000 });
      q = lsGet(K_QUEUE, []).slice(batch.length);
      lsSet(K_QUEUE, q);
    }
  } catch (e) {
    if (e.code === 'no-household' || e.code === 'no-user') {
      lsSet(K_QUEUE, []);
      onWriteError?.(t('err_session'));
    }
    /* غير ذلك: يبقى الطابور كما هو ويُعاد إرساله لاحقًا */
  } finally { flushing = false; }
}

export function pendingWrites() { return (lsGet(K_QUEUE, []) || []).length; }

function localApply(col, id, patch, remove) {
  const bucket = docs[col] || (docs[col] = {});
  const key = String(id);
  const prev = bucket[key] || {};
  bucket[key] = remove
    ? { ...prev, id: prev.id ?? Number(id), deleted: true, updatedAt: Date.now() }
    : { ...prev, ...patch, id: patch?.id ?? prev.id ?? Number(id), deleted: false, updatedAt: Date.now() };
  persistDocs();
  emit(col);
}

export function saveItem(hid, col, item) {
  mark(col, item.id);
  const data = { ...item, createdAt: item.createdAt || Date.now() };
  delete data.purchasedAt;
  localApply(col, item.id, data, false);
  enqueue({ col, id: String(item.id), op: 'set', data });
}

/** فعل موقَّع: التكفّل والإنجاز. الخادم يختم الهوية، فلا يُنسب لأحد فعل غيره. */
export function actItem(hid, col, id, act, patch = {}) {
  mark(col, id);
  localApply(col, id, patch, false);
  enqueue({ col, id: String(id), op: 'merge', act, data: patch });
}

export function patchItem(hid, col, id, patch) {
  mark(col, id);
  localApply(col, id, patch, false);
  enqueue({ col, id: String(id), op: 'merge', data: patch });
}

export function removeItem(hid, col, id) {
  mark(col, id);
  localApply(col, id, null, true);
  enqueue({ col, id: String(id), op: 'delete', numericId: Number(id) || id });
}

/* ---------- Web Push ---------- */
export const pushPublicKey = () => req('/push/key', { auth: false, timeout: 10000 });
export const savePushSubscription = (subscription) =>
  req('/push/subscribe', { method: 'POST', body: { subscription }, timeout: 15000 });
export const dropPushSubscription = (endpoint) =>
  req('/push/subscribe', { method: 'DELETE', body: { endpoint }, timeout: 15000 });
export const sendTestPush = () => req('/push/test', { method: 'POST', timeout: 20000 });

/* ---------- كلمة المرور والاسترداد ---------- */

/** يستعيد الحساب برمز الاسترداد ويبدأ جلسة جديدة */
export async function recoverAccount(email, code, password) {
  const u = await req('/account/recover', {
    method: 'POST', auth: false, timeout: 20000,
    body: { email, code, password },
  });
  keepSession(u);
  return u;
}

/** يغيّر كلمة المرور — يتطلب الحالية، ويُسقط الجلسات الأخرى */
export async function changePassword(current, password) {
  const u = await req('/account/password', { method: 'POST', body: { current, password }, timeout: 20000 });
  keepSession(u);
  return u;
}

/** رمز استرداد جديد — يُعرض مرة واحدة */
export function newRecoveryCode(password) {
  return req('/account/recovery', { method: 'POST', body: { password }, timeout: 15000 });
}

/* ---------- النسخ الاحتياطية (للمشرف) ---------- */
export const listBackups = () => req('/backups', { timeout: 15000 });
export const runBackup = () => req('/backups/now', { method: 'POST', timeout: 30000 });

/* ---------- البيوت المتعددة والأدوار ---------- */
const K_PERM = 'beitna:perm';
let myPerm = (() => { try { return localStorage.getItem(K_PERM) || 'member'; } catch { return 'member'; } })();
export const currentPerm = () => myPerm;
export const isHelper = () => myPerm === 'helper';
export const isOwner = () => myPerm === 'owner';
export function setPerm(p) {
  if (!p || p === myPerm) return;
  myPerm = p;
  /* يُحفظ حتى تبقى حدود العاملة قائمة عند الفتح بلا إنترنت */
  try { localStorage.setItem(K_PERM, p); } catch { /* تجاهل */ }
}

/** كل البيوت التي أنا عضو فيها */
export async function listHouseholds() {
  const r = await req('/households', { timeout: 12000 });
  return r.households || [];
}

/** يبدّل البيت النشط على الخادم ويرجع بياناته */
export async function switchHousehold(id) {
  const hh = await req('/household/switch', { method: 'POST', body: { id }, timeout: 15000 });
  setPerm(hh.perm);
  if (me) { me.householdId = hh.id; lsSet(K_USER, me); }
  return hh;
}

/** كود دعوة العاملة — للمالك فقط */
/* ---------- لوحة التحكم: من المالك فقط (والخادم يتحقق) ---------- */
export function saveSections(sections) {
  return req('/household/ui', { method: 'POST', body: { ui: { sections } }, timeout: 12000 });
}
export function setMemberCaps(uid, caps) {
  return req('/member/' + encodeURIComponent(uid) + '/caps', {
    method: 'POST', body: { caps }, timeout: 12000,
  });
}

export function getHelperCode() { return req('/household/helper-code', { timeout: 10000 }); }
export function newHelperCode() { return req('/household/helper-code', { method: 'POST', timeout: 12000 }); }
export function revokeHelperCode() { return req('/household/helper-code', { method: 'DELETE', timeout: 12000 }); }
export function newInviteCode() { return req('/household/invite-code', { method: 'POST', timeout: 12000 }); }
export function revokeInviteCode() { return req('/household/invite-code', { method: 'DELETE', timeout: 12000 }); }

/** تغيير دور عضو — للمالك فقط */
export function setMemberRole(uid, perm) {
  return req('/member/' + encodeURIComponent(uid) + '/role', { method: 'POST', body: { perm }, timeout: 12000 });
}

/* ---------- الأعضاء ---------- */
export async function loadMembers() {
  try {
    const r = await req('/members', { timeout: 10000 });
    (r.members || []).forEach((m) => { membersMap[m.uid] = m; });
    persistDocs();
  } catch { /* نكتفي بالمحفوظ */ }
  return shapeMembers();
}

export function updateMemberProfile(hid, patch) {
  const uid = currentUid();
  if (!uid) return;
  membersMap[uid] = { ...(membersMap[uid] || { uid }), ...patch, updatedAt: Date.now() };
  persistDocs();
  listeners?.onData?.('members', shapeMembers());
  req('/member', { method: 'POST', body: { patch } }).catch(() => {
    onWriteError?.('لم تُحفظ بيانات ملفك على الخادم بعد — ستُرسل عند عودة الاتصال.');
  });
}

export async function removeMemberCloud(hid, uid) {
  if (membersMap[uid]) { membersMap[uid].deleted = true; persistDocs(); }
  listeners?.onData?.('members', shapeMembers());
  try {
    return await req('/member/' + encodeURIComponent(uid), { method: 'DELETE' });
  } catch (e) {
    onWriteError?.(arabicError(e));
    throw e;
  }
}

/* صور الاحتياجات تمر مؤقتًا عبر ذاكرة الخادم ولا تدخل مستندات المزامنة. */
export function relayPantryImage(itemId, dataUrl) {
  return req('/pantry-image/' + encodeURIComponent(itemId), {
    method: 'POST', body: { dataUrl }, timeout: 20000,
  });
}
export function pullPantryImages() {
  return req('/pantry-images', { timeout: 20000 });
}
export function ackPantryImages(itemIds) {
  return req('/pantry-images/ack', { method: 'POST', body: { itemIds }, timeout: 12000 });
}

/* ---------- تفضيلات الإشعارات ---------- */
export function saveNotificationPrefs(prefs) {
  if (!token) return;
  req('/prefs', { method: 'POST', body: prefs }).catch(() => { /* تُحفظ محليًا أصلًا */ });
}

export async function loadNotificationPrefs() {
  if (!token) return null;
  try { return await req('/prefs', { timeout: 8000 }); } catch { return null; }
}

/* ---------- سجل الدخول (غير مستخدم في الخادم الذاتي) ---------- */
export function recordSession() { /* لا نجمع سجلات أجهزة */ }

