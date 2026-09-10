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

export const isReady = () => ready;
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

/** تهيئة الاتصال — ترجع true عند النجاح */
export async function initCloud() {
  if (ready) return true;
  try {
    const m = await load();
    app = m.initializeApp(CONFIG);
    auth = m.getAuth(app);
    try {
      db = m.initializeFirestore(app, { localCache: m.persistentLocalCache?.({}) });
    } catch {
      db = m.getFirestore(app);
    }
    ready = true;
    return true;
  } catch (e) {
    console.warn('تعذّر تحميل Firebase', e);
    ready = false;
    return false;
  }
}

/** ينتظر معرفة حالة تسجيل الدخول الحالية */
export function waitForUser() {
  return new Promise((resolve) => {
    if (!auth) return resolve(null);
    const off = fb.onAuthStateChanged(auth, (user) => { off(); resolve(user); });
  });
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
  if (code.includes('unavailable') || code.includes('deadline')) return 'انتهت مهلة الاتصال — أعد المحاولة';
  return 'حدث خطأ: ' + code;
}

/* ---------- الحساب ---------- */
export async function signIn(email, password) {
  const cred = await fb.signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function signUp(email, password, displayName) {
  const cred = await fb.createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName) {
    try { await fb.updateProfile(cred.user, { displayName }); } catch { /* تجاهل */ }
  }
  await ensureUserDoc(cred.user, displayName);
  return cred.user;
}

export async function signOutCloud() {
  stopSync();
  try { await fb.signOut(auth); } catch { /* تجاهل */ }
}

async function ensureUserDoc(user, displayName) {
  const ref = fb.doc(db, 'users', user.uid);
  const snap = await fb.getDoc(ref);
  const name = displayName || user.displayName || (user.email || '').split('@')[0] || 'مستخدم';
  if (!snap.exists()) {
    await fb.setDoc(ref, {
      uid: user.uid, email: user.email || '', displayName: name,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  } else {
    await fb.setDoc(ref, { updatedAt: Date.now() }, { merge: true });
  }
}

/* ---------- البيت ---------- */
export async function loadHouseholdId() {
  const uid = currentUid();
  if (!uid) return null;
  const snap = await fb.getDoc(fb.doc(db, 'users', uid));
  return snap.exists() ? (snap.data().householdId || null) : null;
}

function makeInviteCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return 'BEITNA-' + s;
}

export async function createHousehold(name, memberName) {
  const user = auth.currentUser;
  const inviteCode = makeInviteCode();
  const ref = fb.doc(fb.collection(db, 'households'));
  await fb.setDoc(ref, {
    name, inviteCode,
    createdBy: user.uid,
    ownerName: memberName,
    createdAt: Date.now(),
  });
  await fb.setDoc(fb.doc(db, 'households', ref.id, 'members', user.uid), {
    uid: user.uid, name: memberName, email: user.email || '',
    role: 'مالك البيت', isOwner: true, joinedAt: Date.now(),
  });
  await fb.setDoc(fb.doc(db, 'users', user.uid), {
    householdId: ref.id, displayName: memberName, updatedAt: Date.now(),
  }, { merge: true });
  await seedCategories(ref.id);
  return { id: ref.id, name, inviteCode };
}

export async function joinHousehold(code, memberName) {
  const user = auth.currentUser;
  const q = fb.query(
    fb.collection(db, 'households'),
    fb.where('inviteCode', '==', code.trim().toUpperCase()),
    fb.limit(1),
  );
  const res = await fb.getDocs(q);
  if (res.empty) throw new Error('bad-code');
  const hd = res.docs[0];
  await fb.setDoc(fb.doc(db, 'households', hd.id, 'members', user.uid), {
    uid: user.uid, name: memberName, email: user.email || '',
    role: 'عضو', isOwner: false, joinedAt: Date.now(),
  });
  await fb.setDoc(fb.doc(db, 'users', user.uid), {
    householdId: hd.id, displayName: memberName, updatedAt: Date.now(),
  }, { merge: true });
  return { id: hd.id, name: hd.data().name || 'بيتي', inviteCode: hd.data().inviteCode || code };
}

export async function loadHousehold(hid) {
  const snap = await fb.getDoc(fb.doc(db, 'households', hid));
  if (!snap.exists()) return null;
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

async function seedCategories(hid) {
  await Promise.all(DEFAULT_CATEGORIES.map(([id, name, icon, type]) =>
    fb.setDoc(fb.doc(db, 'households', hid, 'categories', String(id)),
      { id, name, icon, type, createdAt: Date.now() })));
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

export async function updateMemberProfile(hid, patch) {
  const uid = currentUid();
  if (!uid) return;
  await fb.setDoc(fb.doc(db, 'households', hid, 'members', uid), patch, { merge: true });
  if (patch.name) {
    await fb.setDoc(fb.doc(db, 'users', uid), { displayName: patch.name, updatedAt: Date.now() }, { merge: true });
  }
}

export async function removeMemberCloud(hid, uid) {
  await fb.deleteDoc(fb.doc(db, 'households', hid, 'members', uid));
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

export async function saveItem(hid, col, item) {
  mark(col, item.id);
  const data = { ...item, createdAt: item.createdAt || Date.now() };
  delete data.purchasedAt;
  await fb.setDoc(fb.doc(db, 'households', hid, col, String(item.id)), data);
}

export async function patchItem(hid, col, id, patch) {
  mark(col, id);
  await fb.setDoc(fb.doc(db, 'households', hid, col, String(id)), patch, { merge: true });
}

export async function removeItem(hid, col, id) {
  mark(col, id);
  await fb.deleteDoc(fb.doc(db, 'households', hid, col, String(id)));
}

/* ---------- تفضيلات الإشعارات ---------- */
export async function saveNotificationPrefs(prefs) {
  const uid = currentUid();
  if (!uid) return;
  await fb.setDoc(fb.doc(db, 'users', uid, 'prefs', 'notifications'),
    { ...prefs, updatedAt: Date.now() }, { merge: true });
}

export async function loadNotificationPrefs() {
  const uid = currentUid();
  if (!uid) return null;
  const snap = await fb.getDoc(fb.doc(db, 'users', uid, 'prefs', 'notifications'));
  return snap.exists() ? snap.data() : null;
}

/* ---------- سجل الدخول ---------- */
export async function recordSession() {
  const uid = currentUid();
  if (!uid) return;
  try {
    await fb.addDoc(fb.collection(db, 'users', uid, 'sessions'), {
      deviceModel: navigator.platform || 'Web',
      androidVersion: 'Web — ' + (navigator.userAgent.split(')')[0].split('(')[1] || 'browser'),
      timestamp: Date.now(), signedIn: true,
    });
  } catch { /* غير مهم */ }
}
