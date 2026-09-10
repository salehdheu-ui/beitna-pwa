/* ============================================================
   طبقة السحابة — خادم "بيتنا" الخاص بك
   مستضاف على خادمك أنت. لا Firebase ولا أي طرف خارجي.
   يعمل بدون إنترنت: كل شيء محفوظ محليًا، والتغييرات
   تُرسل تلقائيًا أول ما يعود الاتصال.
   ============================================================ */

const API = (window.BEITNA_API || (location.origin + '/api')).replace(/\/+$/, '');

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

export function setWriteErrorHandler(fn) { onWriteError = fn; }
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
    lsSet(K_USER, me);
  }).catch((e) => {
    if (e.code === 'no-user') { /* انتهت الجلسة */ token = null; me = null; lsDel(K_TOKEN); lsDel(K_USER); }
  });
  return me;
}

/* ---------- رسائل الأخطاء ---------- */
export function arabicError(e) {
  const code = String(e?.code || e?.message || '');
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'كلمة المرور خاطئة';
  if (code.includes('user-not-found')) return 'لا يوجد حساب بهذا البريد';
  if (code.includes('email-already-in-use')) return 'هذا البريد مسجَّل من قبل';
  if (code.includes('invalid-email')) return 'صيغة البريد غير صحيحة';
  if (code.includes('weak-password')) return 'كلمة المرور يجب 6 أحرف على الأقل';
  if (code.includes('too-many-requests')) return 'محاولات كثيرة — انتظر ربع ساعة ثم أعد المحاولة';
  if (code.includes('bad-code')) return 'كود الدعوة غير صحيح أو غير موجود';
  if (code.includes('offline')) return 'لا يوجد اتصال بالإنترنت — هذه الخطوة تحتاج اتصالًا';
  if (code.includes('auth-timeout')) return 'تأخّر ردّ الخادم — تحقق من الإنترنت وأعد المحاولة';
  if (code.includes('network')) return 'تعذّر الوصول إلى الخادم — تحقق من الإنترنت';
  if (code.includes('no-user')) return 'انتهت الجلسة — سجّل دخولك من جديد';
  if (code.includes('no-household')) return 'لم يعد لك بيت — أنشئ بيتًا أو انضم بكود';
  if (code.includes('owner-only')) return 'هذه العملية لمالك البيت فقط';
  return 'حدث خطأ: ' + code;
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
  return keepSession(u);
}

export async function signOutCloud() {
  stopSync();
  if (hidActive) lsDel(K_DOCS(hidActive));
  token = null; me = null; hidActive = null; docs = {}; membersMap = {}; cursor = 0;
  lsDel(K_TOKEN); lsDel(K_USER); lsDel(K_QUEUE);
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
  if (me) { me.householdId = hh.id; me.displayName = memberName || me.displayName; lsSet(K_USER, me); }
  return hh;
}

export async function joinHousehold(code, memberName) {
  const hh = await req('/household/join', { method: 'POST', body: { code, memberName } });
  if (me) { me.householdId = hh.id; me.displayName = memberName || me.displayName; lsSet(K_USER, me); }
  return hh;
}

export async function loadHousehold(hid) {
  try {
    const hh = await req('/household', { timeout: 10000 });
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
    status: d.status || 'ناقص', owner: d.owner || '', ownerUid: d.ownerUid || '',
    price: d.price || '', priceValue: Number(d.priceValue) || 0,
    createdAt: Number(d.createdAt) || Date.now(), purchasedAt: d.purchasedAt || 0,
  }),
  faults: (d) => ({
    id: Number(d.id), title: d.title || '', location: d.location || '',
    priority: d.priority || 'متوسط', status: d.status || 'جديد', note: d.note || '',
    linkedItems: d.linkedItems || [], photoUrl: d.photoUrl || '', ownerUid: d.ownerUid || '',
    estimatedCost: Number(d.estimatedCost) || 0, actualCost: Number(d.actualCost) || 0,
    technician: d.technician || '', repairDate: Number(d.repairDate) || 0,
    createdAt: Number(d.createdAt) || Date.now(),
  }),
  occasions: (d) => ({
    id: Number(d.id), title: d.title || '', type: d.type || 'مناسبة عامة',
    date: d.date || '', dateMillis: Number(d.dateMillis) || Date.now(),
    reminder: d.reminder || '', note: d.note || '', linkedItems: d.linkedItems || [],
    recurring: d.recurring || 'بدون', reminderTime: d.reminderTime || '09:00',
    reminderOffsets: d.reminderOffsets || [], done: !!d.done,
    createdAt: Number(d.createdAt) || Date.now(),
  }),
  categories: (d) => ({ id: Number(d.id), name: d.name || '', icon: d.icon || '📦', type: d.type || 'Shopping' }),
  favoriteLists: (d) => ({ id: Number(d.id), name: d.name || '', icon: d.icon || '⭐', items: d.items || [] }),
};

const LABELS = {
  shopping: (x) => `🛒 أُضيف للمشتريات: ${x.name}`,
  faults: (x) => `🔧 عطل جديد: ${x.title}`,
  occasions: (x) => `🎉 مناسبة جديدة: ${x.title}`,
};

const COLS = ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists'];

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

export function startSync(hid, { onData, onPartnerActivity }) {
  stopSync();
  hidActive = hid;
  listeners = { onData, onPartnerActivity };
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
    if (e.code === 'no-user') { /* الجلسة انتهت — الواجهة ستطلب الدخول */ }
  } finally { ticking = false; }
}

function applySync(res) {
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

  cursor = res.now || cursor;
  if (changed || res.full) persistDocs();
  firstEmit = false;

  for (const [col, x] of fresh) {
    if (x.ownerUid && x.ownerUid === currentUid()) continue;
    listeners?.onPartnerActivity?.(LABELS[col](x));
  }
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
      onWriteError?.('انتهت جلستك — سجّل دخولك من جديد لمزامنة التغييرات.');
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

export function removeMemberCloud(hid, uid) {
  if (membersMap[uid]) { membersMap[uid].deleted = true; persistDocs(); }
  listeners?.onData?.('members', shapeMembers());
  req('/member/' + encodeURIComponent(uid), { method: 'DELETE' }).catch((e) => {
    onWriteError?.(arabicError(e));
  });
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
