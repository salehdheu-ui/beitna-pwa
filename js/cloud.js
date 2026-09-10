/* ============================================================
   طبقة السحابة — Firebase Auth + Firestore
   نفس مشروع تطبيق الأندرويد ونفس بنية البيانات،
   فتتزامن البيانات بين الموقع والتطبيق وكل أجهزة أفراد البيت.
   ============================================================ */

const CONFIG = {
  apiKey: 'AIzaSyARYk1HopQQVzy0DlYbmWYVe7opZPDH9eM',
  authDomain: 'beitna-c9ce7.firebaseapp.com',
  projectId: 'beitna-c9ce7',
  storageBucket: 'beitna-c9ce7.firebasestorage.app',
  messagingSenderId: '1039309246355',
};

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* الحالة الداخلية */
let fb = null;          // وحدات Firebase بعد التحميل
let app = null, auth = null, db = null;
let unsubs = [];
let selfWrites = new Set();   // عناصر كتبناها نحن — لا ننبّه عليها
let seen = {};                // معرّفات شوهدت لكل مجموعة
let ready = false;
let onWriteError = null;      // يُبلّغ الواجهة عند فشل مزامنة

export function setWriteErrorHandler(fn) { onWriteError = fn; }

/** كل عمليات الكتابة تُطلق ولا تُنتظر — Firestore يطبّقها محليًا ويزامنها لاحقًا */
function fire(promise, what) {
  Promise.resolve(promise).catch((e) => {
    const code = String(e?.code || e?.message || '');
    console.warn('تعذّرت مزامنة', what, code);
    if (code.includes('permission-denied')) {
      onWriteError?.('صلاحيات قاعدة البيانات لا تسمح بهذه العملية — البيانات محفوظة على جهازك.');
    }
  });
  return promise;
}

export const isReady = () => ready;

/** يمنع أي عملية شبكة من تعليق التطبيق للأبد */
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
export const currentUid = () => auth?.currentUser?.uid || null;
export const currentEmail = () => auth?.currentUser?.email || null;

/* ---------- تحميل المكتبة ---------- */
async function load() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(/* @vite-ignore */ SDK + 'firebase-app.js'),
    import(/* @vite-ignore */ SDK + 'firebase-auth.js'),
    import(/* @vite-ignore */ SDK + 'firebase-firestore.js'),
  ]);
  fb = { ...appMod, ...authMod, ...fsMod };
  return fb;
}

/** يفحص إن كان IndexedDB يستجيب فعلًا (على بعض الأجهزة يتجمّد) */
function idbUsable() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(false), 1500);
    try {
      if (!self.indexedDB) return done(false);
      const req = indexedDB.open('beitna-idb-probe', 1);
      req.onsuccess = () => { try { req.result.close(); } catch { /* تجاهل */ } done(true); };
      req.onerror = () => done(false);
      req.onblocked = () => done(false);
    } catch { done(false); }
  });
}

/** تهيئة الاتصال — ترجع true عند النجاح */
export async function initCloud(timeoutMs = 9000) {
  if (ready) return true;
  try {
    const m = await withTimeout(load(), timeoutMs, null);
    if (!m) { console.warn('انتهت مهلة تحميل Firebase'); return false; }
    app = m.initializeApp(CONFIG);

    /* الحساب: نحفظ الجلسة في localStorage لا في IndexedDB.
       تخزين IndexedDB يتجمّد على بعض الأجهزة فلا تُستدعى onAuthStateChanged أبدًا. */
    try {
      auth = m.initializeAuth(app, {
        persistence: [m.browserLocalPersistence, m.browserSessionPersistence, m.inMemoryPersistence]
          .filter(Boolean),
      });
    } catch {
      auth = m.getAuth(app);
    }

    /* قاعدة البيانات: تخزين دائم إن كان IndexedDB سليمًا، وإلا ذاكرة مؤقتة.
       بيانات التطبيق محفوظة أصلًا في المتصفح، فالعمل بدون إنترنت مضمون في الحالتين. */
    try {
      const idbOk = await idbUsable();
      let localCache;
      if (idbOk && m.persistentLocalCache) {
        localCache = m.persistentLocalCache({});
      } else if (m.memoryLocalCache) {
        localCache = m.memoryLocalCache();
        if (!idbOk) console.warn('IndexedDB غير مستجيب — تخزين Firestore في الذاكرة');
      }
      db = localCache
        ? m.initializeFirestore(app, { localCache })
        : m.initializeFirestore(app, {});
    } catch (e) {
      console.warn('تعذّر ضبط تخزين Firestore', e);
      try { db = m.getFirestore(app); } catch { db = m.initializeFirestore(app, {}); }
    }

    ready = true;
    return true;
  } catch (e) {
    console.warn('تعذّر تحميل Firebase', e);
    ready = false;
    return false;
  }
}

/** ينتظر معرفة حالة تسجيل الدخول الحالية (بمهلة قصوى) */
export function waitForUser(timeoutMs = 5000) {
  const p = new Promise((resolve) => {
    if (!auth || !fb) return resolve(null);
    try {
      const off = fb.onAuthStateChanged(auth, (user) => { off(); resolve(user); });
    } catch { resolve(null); }
  });
  return withTimeout(p, timeoutMs, null);
}

/* ---------- رسائل الأخطاء بالعربية ---------- */
export function arabicError(e) {
  const code = String(e?.code || e?.message || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'كلمة المرور خاطئة';
  if (code.includes('user-not-found')) return 'لا يوجد حساب بهذا البريد';
  if (code.includes('email-already-in-use')) return 'هذا البريد مسجَّل من قبل';
  if (code.includes('invalid-email')) return 'صيغة البريد غير صحيحة';
  if (code.includes('weak-password')) return 'كلمة المرور يجب 6 أحرف على الأقل';
  if (code.includes('too-many-requests')) return 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة';
  if (code.includes('network')) return 'تعذّر الاتصال بالخادم — تحقق من الإنترنت';
  if (code.includes('permission-denied')) return 'صلاحيات Firestore لا تسمح بالعملية حاليًا';
  if (code.includes('auth-timeout')) return 'تأخّر ردّ خادم الحساب — تحقق من الإنترنت وأعد المحاولة';
  if (code.includes('operation-not-allowed')) return 'إنشاء الحسابات بالبريد غير مفعّل في المشروع';
  if (code.includes('offline-join')) return 'الانضمام بكود يحتاج إنترنت — تحقق من الاتصال وأعد المحاولة';
  if (code.includes('no-user')) return 'انتهت الجلسة — سجّل دخولك من جديد';
  if (code.includes('unavailable') || code.includes('deadline')) return 'انتهت مهلة الاتصال — أعد المحاولة';
  return 'حدث خطأ: ' + code;
}

/* ---------- الحساب ---------- */
export async function signIn(email, password) {
  const cred = await withTimeout(
    fb.signInWithEmailAndPassword(auth, email.trim(), password), 15000, 'TIMEOUT');
  if (cred === 'TIMEOUT') throw new Error('auth-timeout');
  ensureUserDoc(cred.user);           // بدون انتظار
  return cred.user;
}

export async function signUp(email, password, displayName) {
  const cred = await withTimeout(
    fb.createUserWithEmailAndPassword(auth, email.trim(), password), 15000, 'TIMEOUT');
  if (cred === 'TIMEOUT') throw new Error('auth-timeout');
  if (displayName) {
    fire(fb.updateProfile(cred.user, { displayName }), 'الاسم');
  }
  ensureUserDoc(cred.user, displayName);   // بدون انتظار
  return cred.user;
}

export async function signOutCloud() {
  stopSync();
  try { await fb.signOut(auth); } catch { /* تجاهل */ }
}

function ensureUserDoc(user, displayName) {
  const ref = fb.doc(db, 'users', user.uid);
  const name = displayName || user.displayName || (user.email || '').split('@')[0] || 'مستخدم';
  fire(fb.setDoc(ref, {
    uid: user.uid, email: user.email || '', displayName: name,
    updatedAt: Date.now(),
  }, { merge: true }), 'مستند المستخدم');
}

/* ---------- البيت ---------- */
async function readDoc(ref, timeoutMs = 6000) {
  try {
    const snap = await withTimeout(fb.getDoc(ref), timeoutMs, 'TIMEOUT');
    if (snap !== 'TIMEOUT') return snap;
  } catch { /* نجرّب الذاكرة المحلية */ }
  try { return await fb.getDocFromCache(ref); } catch { return null; }
}

export async function loadHouseholdId() {
  const uid = currentUid();
  if (!uid) return null;
  const snap = await readDoc(fb.doc(db, 'users', uid));
  return snap?.exists?.() ? (snap.data().householdId || null) : null;
}

function makeInviteCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return 'BEITNA-' + s;
}

export function createHousehold(name, memberName) {
  const user = auth.currentUser;
  if (!user) throw new Error('no-user');
  const inviteCode = makeInviteCode();
  const ref = fb.doc(fb.collection(db, 'households'));

  /* كل الكتابات تُطلق فورًا — تُطبَّق محليًا وتتزامن متى توفّر الإنترنت */
  fire(fb.setDoc(ref, {
    name, inviteCode, createdBy: user.uid, ownerName: memberName, createdAt: Date.now(),
  }), 'إنشاء البيت');

  fire(fb.setDoc(fb.doc(db, 'households', ref.id, 'members', user.uid), {
    uid: user.uid, name: memberName, email: user.email || '',
    role: 'مالك البيت', isOwner: true, joinedAt: Date.now(),
  }), 'العضوية');

  fire(fb.setDoc(fb.doc(db, 'users', user.uid), {
    householdId: ref.id, displayName: memberName, updatedAt: Date.now(),
  }, { merge: true }), 'ربط المستخدم بالبيت');

  seedCategories(ref.id);
  return { id: ref.id, name, inviteCode };
}

export async function joinHousehold(code, memberName) {
  const user = auth.currentUser;
  if (!user) throw new Error('no-user');
  const q = fb.query(
    fb.collection(db, 'households'),
    fb.where('inviteCode', '==', code.trim().toUpperCase()),
    fb.limit(1),
  );
  const res = await withTimeout(fb.getDocs(q), 12000, 'TIMEOUT');
  if (res === 'TIMEOUT') throw new Error('offline-join');
  if (res.empty) throw new Error('bad-code');
  const hd = res.docs[0];

  fire(fb.setDoc(fb.doc(db, 'households', hd.id, 'members', user.uid), {
    uid: user.uid, name: memberName, email: user.email || '',
    role: 'عضو', isOwner: false, joinedAt: Date.now(),
  }), 'العضوية');

  fire(fb.setDoc(fb.doc(db, 'users', user.uid), {
    householdId: hd.id, displayName: memberName, updatedAt: Date.now(),
  }, { merge: true }), 'ربط المستخدم بالبيت');

  return { id: hd.id, name: hd.data().name || 'بيتي', inviteCode: hd.data().inviteCode || code };
}

export async function loadHousehold(hid) {
  const snap = await readDoc(fb.doc(db, 'households', hid));
  if (!snap?.exists?.()) return null;
  const d = snap.data();
  return { id: hid, name: d.name || 'بيتي', inviteCode: d.inviteCode || '', createdAt: d.createdAt || Date.now() };
}

const DEFAULT_CATEGORIES = [
  [1, 'بقالة', '🛒', 'Shopping'], [2, 'منظفات', '🧴', 'Shopping'],
  [3, 'خضار وفواكه', '🥬', 'Shopping'], [4, 'لحوم', '🥩', 'Shopping'],
  [5, 'صيدلية', '💊', 'Shopping'], [6, 'المطبخ', '🍳', 'FaultLocation'],
  [7, 'الصالة', '🛋️', 'FaultLocation'], [8, 'غرفة النوم', '🛏️', 'FaultLocation'],
  [9, 'الحمام', '🚿', 'FaultLocation'], [10, 'غرفة الغسيل', '🧺', 'FaultLocation'],
  [11, 'عيد ميلاد', '🎂', 'OccasionType'], [12, 'فاتورة', '💡', 'OccasionType'],
  [13, 'صيانة دورية', '🔧', 'OccasionType'], [14, 'مناسبة عائلية', '👨‍👩‍👧', 'OccasionType'],
];

function seedCategories(hid) {
  DEFAULT_CATEGORIES.forEach(([id, name, icon, type]) => {
    fire(fb.setDoc(fb.doc(db, 'households', hid, 'categories', String(id)),
      { id, name, icon, type, createdAt: Date.now() }), 'التصنيفات');
  });
}

/* ---------- الأعضاء ---------- */
export async function loadMembers(hid) {
  const res = await fb.getDocs(fb.collection(db, 'households', hid, 'members'));
  return res.docs.map((d, i) => {
    const m = d.data();
    return {
      id: i + 1, uid: d.id, name: m.name || 'عضو', role: m.role || 'عضو',
      phone: m.phone || '', email: m.email || '',
      isOwner: !!m.isOwner, isOnline: d.id === currentUid(),
      joinedAt: m.joinedAt || 0,
    };
  }).sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

export function updateMemberProfile(hid, patch) {
  const uid = currentUid();
  if (!uid) return;
  fire(fb.setDoc(fb.doc(db, 'households', hid, 'members', uid), patch, { merge: true }), 'الملف الشخصي');
  if (patch.name) {
    fire(fb.setDoc(fb.doc(db, 'users', uid),
      { displayName: patch.name, updatedAt: Date.now() }, { merge: true }), 'الاسم');
  }
}

export function removeMemberCloud(hid, uid) {
  fire(fb.deleteDoc(fb.doc(db, 'households', hid, 'members', uid)), 'إزالة عضو');
}

/* ============================================================
   المزامنة اللحظية
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

/**
 * يبدأ الاستماع اللحظي لكل المجموعات.
 * onData(collection, items) — لتحديث الحالة
 * onPartnerActivity(text)   — لإظهار إشعار بنشاط فرد آخر
 */
export function startSync(hid, { onData, onPartnerActivity }) {
  stopSync();
  seen = {};
  const cols = ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists'];

  cols.forEach((col) => {
    const ref = fb.collection(db, 'households', hid, col);
    const un = fb.onSnapshot(ref, (snap) => {
      const items = [];
      snap.forEach((doc) => {
        const raw = { ...doc.data(), id: doc.data().id ?? doc.id };
        try { items.push(MAPPERS[col](raw)); } catch { /* تجاهل مستندًا تالفًا */ }
      });

      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onData?.(col, items);

      /* تنبيه نشاط الشريك */
      const first = seen[col] === undefined;
      const ids = new Set(items.map((x) => x.id));
      if (!first && LABELS[col]) {
        items.forEach((x) => {
          if (seen[col].has(x.id)) return;
          if (selfWrites.has(col + ':' + x.id)) return;
          if (x.ownerUid && x.ownerUid === currentUid()) return;
          onPartnerActivity?.(LABELS[col](x));
        });
      }
      seen[col] = ids;
    }, (err) => console.warn('خطأ في المزامنة', col, err));
    unsubs.push(un);
  });

  /* الأعضاء */
  const mref = fb.collection(db, 'households', hid, 'members');
  unsubs.push(fb.onSnapshot(mref, (snap) => {
    const members = snap.docs.map((d, i) => {
      const m = d.data();
      return {
        id: i + 1, uid: d.id, name: m.name || 'عضو', role: m.role || 'عضو',
        phone: m.phone || '', email: m.email || '',
        isOwner: !!m.isOwner, isOnline: d.id === currentUid(), joinedAt: m.joinedAt || 0,
      };
    }).sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
    onData?.('members', members);
  }, () => {}));
}

export function stopSync() {
  unsubs.forEach((u) => { try { u(); } catch { /* تجاهل */ } });
  unsubs = [];
}

/* ============================================================
   الكتابة
   ============================================================ */
function mark(col, id) {
  selfWrites.add(col + ':' + id);
  setTimeout(() => selfWrites.delete(col + ':' + id), 60000);
}

export function saveItem(hid, col, item) {
  mark(col, item.id);
  const data = { ...item, createdAt: item.createdAt || Date.now() };
  delete data.purchasedAt;
  fire(fb.setDoc(fb.doc(db, 'households', hid, col, String(item.id)), data), col);
}

export function patchItem(hid, col, id, patch) {
  mark(col, id);
  fire(fb.setDoc(fb.doc(db, 'households', hid, col, String(id)), patch, { merge: true }), col);
}

export function removeItem(hid, col, id) {
  mark(col, id);
  fire(fb.deleteDoc(fb.doc(db, 'households', hid, col, String(id))), col);
}

/* ---------- تفضيلات الإشعارات ---------- */
export function saveNotificationPrefs(prefs) {
  const uid = currentUid();
  if (!uid) return;
  fire(fb.setDoc(fb.doc(db, 'users', uid, 'prefs', 'notifications'),
    { ...prefs, updatedAt: Date.now() }, { merge: true }), 'تفضيلات الإشعارات');
}

export async function loadNotificationPrefs() {
  const uid = currentUid();
  if (!uid) return null;
  const snap = await fb.getDoc(fb.doc(db, 'users', uid, 'prefs', 'notifications'));
  return snap.exists() ? snap.data() : null;
}

/* ---------- سجل الدخول ---------- */
export function recordSession() {
  const uid = currentUid();
  if (!uid) return;
  try {
    fire(fb.addDoc(fb.collection(db, 'users', uid, 'sessions'), {
      deviceModel: navigator.platform || 'Web',
      androidVersion: 'Web — ' + (navigator.userAgent.split(')')[0].split('(')[1] || 'browser'),
      timestamp: Date.now(), signedIn: true,
    }), 'سجل الدخول');
  } catch { /* غير مهم */ }
}
