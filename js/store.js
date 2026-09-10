/* ============================================================
   طبقة البيانات — تخزين محلي أوفلاين أولًا
   نفس نماذج البيانات المستخدمة في تطبيق أندرويد "بيتنا"
   ============================================================ */

import { nextId, uid, todayStart, startOfDay, fmtDate } from './util.js';

const KEY = 'beitna:state:v1';

/* ---------- الثوابت ---------- */
export const SHOP_STATUS = ['ناقص', 'قيد الشراء', 'تم الشراء', 'مؤجل'];
export const SHOP_PRIORITY = ['عادي', 'مهم', 'ضروري'];
export const FAULT_STATUS = ['جديد', 'قيد المتابعة', 'بانتظار فني', 'تم الإصلاح'];
export const FAULT_PRIORITY = ['منخفض', 'متوسط', 'عاجل'];
export const REMINDER_OFFSETS = [
  { id: 'WEEK', label: 'قبل أسبوع', days: 7 },
  { id: 'THREE_DAYS', label: 'قبل 3 أيام', days: 3 },
  { id: 'DAY', label: 'قبل يوم', days: 1 },
  { id: 'MORNING', label: 'صباح نفس اليوم', days: 0 },
];
export const CURRENCY = 'ر.ع';

const DEFAULT_CATEGORIES = [
  { id: 1, name: 'بقالة', icon: '🛒', type: 'Shopping' },
  { id: 2, name: 'منظفات', icon: '🧴', type: 'Shopping' },
  { id: 3, name: 'خضار وفواكه', icon: '🥬', type: 'Shopping' },
  { id: 4, name: 'لحوم', icon: '🥩', type: 'Shopping' },
  { id: 5, name: 'صيدلية', icon: '💊', type: 'Shopping' },
  { id: 6, name: 'المطبخ', icon: '🍳', type: 'FaultLocation' },
  { id: 7, name: 'الصالة', icon: '🛋️', type: 'FaultLocation' },
  { id: 8, name: 'غرفة النوم', icon: '🛏️', type: 'FaultLocation' },
  { id: 9, name: 'الحمام', icon: '🚿', type: 'FaultLocation' },
  { id: 10, name: 'غرفة الغسيل', icon: '🧺', type: 'FaultLocation' },
  { id: 11, name: 'عيد ميلاد', icon: '🎂', type: 'OccasionType' },
  { id: 12, name: 'فاتورة', icon: '💡', type: 'OccasionType' },
  { id: 13, name: 'صيانة دورية', icon: '🔧', type: 'OccasionType' },
  { id: 14, name: 'مناسبة عائلية', icon: '👨‍👩‍👧', type: 'OccasionType' },
];

const DEFAULT_NOTIFICATIONS = {
  shoppingReminders: true,
  faultUpdates: true,
  occasionAlerts: true,
  partnerActivity: true,
  dailySummary: false,
  sound: true,
  vibration: true,
  quietHours: false,
};

function blankState() {
  return {
    version: 1,
    onboarded: false,
    profile: { name: '', email: '', role: 'مالك البيت', phone: '', joinedAt: Date.now(), isOwner: true },
    household: { name: '', inviteCode: '', createdAt: Date.now() },
    members: [],
    shopping: [],
    faults: [],
    occasions: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    favoriteLists: [],
    activities: [],
    notifications: { ...DEFAULT_NOTIFICATIONS },
    settings: { darkMode: false, language: 'العربية' },
  };
}

/* ============================================================
   جسر السحابة — يُفعَّل عند تسجيل الدخول بحساب
   ============================================================ */
let mode = 'local';               // local | cloud
let householdId = null;
let bridge = null;                // { save, patch, remove, profile }
let cloudUid = null;

export function setCloudUid(u) { cloudUid = u; }

export const getMode = () => mode;
export const isCloud = () => mode === 'cloud';
export const getHouseholdId = () => householdId;

export function setCloudBridge(b, hid) {
  bridge = b; householdId = hid; mode = b ? 'cloud' : 'local';
}

function push(op, col, ...args) {
  if (mode !== 'cloud' || !bridge) return;
  try { bridge[op]?.(col, ...args); } catch (e) { console.warn('تعذّرت المزامنة', e); }
}

/** معرّف رقمي شبه فريد يتوافق مع نوع Int في تطبيق الأندرويد */
export function newId() {
  const minutes = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60000);
  return minutes * 100 + Math.floor(Math.random() * 100);
}

/** يستبدل مجموعة قادمة من السحابة دون إعادة إرسالها */
export function applyRemote(collection, items) {
  update((s) => { s[collection] = items; });
}

/* ---------- التحميل والحفظ ---------- */
let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankState();
    const parsed = JSON.parse(raw);
    return { ...blankState(), ...parsed };
  } catch {
    return blankState();
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('تعذّر الحفظ المحلي', e); }
  }, 60);
}

function emit() {
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

export const getState = () => state;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** تعديل الحالة بأمان */
export function update(mutator) {
  mutator(state);
  emit();
}

export function resetAll() {
  state = blankState();
  emit();
}

/* ---------- سجل النشاطات ---------- */
export function logActivity(text) {
  state.activities.unshift({ id: uid(), text, time: Date.now() });
  if (state.activities.length > 60) state.activities.length = 60;
}

/* ---------- كود الدعوة ---------- */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateInviteCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return 'BEITNA-' + s;
}

/* ---------- التهيئة الأولى ---------- */
export function setupHousehold({ householdName, memberName, email = '', joinCode = '',
  inviteCode = '', isOwner = null, cloud = false }) {
  const owner = isOwner === null ? !joinCode : isOwner;
  update((s) => {
    s.onboarded = true;
    s.profile.name = memberName;
    s.profile.email = email;
    s.profile.joinedAt = Date.now();
    s.profile.isOwner = owner;
    s.profile.role = owner ? 'مالك البيت' : 'عضو';
    s.household.name = householdName || `بيت ${memberName}`;
    s.household.inviteCode = inviteCode || joinCode || generateInviteCode();
    s.household.createdAt = Date.now();
    s.household.cloud = cloud;
    if (!cloud) {
      s.members = [{
        id: 1, name: memberName, role: s.profile.role, phone: '',
        isOnline: true, isOwner: owner,
      }];
    }
    if (cloud) { s.shopping = []; s.faults = []; s.occasions = []; s.favoriteLists = []; }
    logActivity(joinCode || !owner ? `انضم ${memberName} إلى البيت` : `تم إنشاء ${s.household.name}`);
  });
}

let logoutHook = null;
export function setLogoutHook(fn) { logoutHook = fn; }

export function signOut() {
  try { logoutHook?.(); } catch (e) { console.warn(e); }
  const keepSettings = { ...state.settings };
  state = blankState();
  state.settings = keepSettings;
  emit();
}

/* ============================================================
   المشتريات
   ============================================================ */
export function addShopping({ name, quantity = '', category = '', priority = 'عادي', note = '', price = '' }) {
  let created;
  update((s) => {
    created = {
      id: newId(),
      name, quantity, category, priority, note,
      status: 'ناقص',
      owner: s.profile.name || 'أنا',
      ownerUid: cloudUid || 'local',
      price: String(price ?? ''),
      priceValue: parseFloat(price) || 0,
      createdAt: Date.now(),
    };
    s.shopping.unshift(created);
    logActivity(`تمت إضافة عنصر: ${name}`);
  });
  push('save', 'shopping', created);
  return created;
}

export function updateShopping(id, patch) {
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (patch.price !== undefined) it.priceValue = parseFloat(patch.price) || 0;
    if (patch.status) logActivity('تم تحديث عنصر مشتريات');
    push('patch', 'shopping', id, { ...patch, priceValue: it.priceValue });
  });
}

export function setShoppingStatus(id, status) {
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    it.status = status;
    if (status === 'تم الشراء') it.purchasedAt = Date.now();
    logActivity(`${status}: ${it.name}`);
    push('patch', 'shopping', id, { status });
  });
}

export function deleteShopping(id) {
  update((s) => {
    s.shopping = s.shopping.filter((x) => x.id !== id);
    logActivity('تم حذف عنصر');
    push('remove', 'shopping', id);
  });
}

export function saveFavoriteList(name, icon, items) {
  const list = {
    id: newId(), name, icon: icon || '⭐',
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, category: i.category })),
    updatedAt: Date.now(),
  };
  update((s) => {
    s.favoriteLists.unshift(list);
    logActivity(`تم حفظ قائمة مفضلة: ${name}`);
  });
  push('save', 'favoriteLists', list);
}

export function deleteFavoriteList(id) {
  update((s) => { s.favoriteLists = s.favoriteLists.filter((x) => x.id !== id); });
  push('remove', 'favoriteLists', id);
}

export function applyFavoriteList(id) {
  const list = state.favoriteLists.find((x) => x.id === id);
  if (!list) return 0;
  list.items.forEach((i) => addShopping({ name: i.name, quantity: i.quantity, category: i.category }));
  return list.items.length;
}

/* ============================================================
   الأعطال
   ============================================================ */
export function addFault({ title, location = '', priority = 'متوسط', note = '', photoUrl = '', estimatedCost = 0 }) {
  let created;
  update((s) => {
    created = {
      id: newId(),
      title, location, priority, note,
      status: 'جديد',
      linkedItems: [],
      photoUrl,
      ownerUid: cloudUid || 'local',
      estimatedCost: Number(estimatedCost) || 0,
      actualCost: 0,
      createdAt: Date.now(),
    };
    s.faults.unshift(created);
    logActivity(`تم تسجيل عطل: ${title}`);
  });
  push('save', 'faults', created);
  return created;
}

export function updateFault(id, patch) {
  update((s) => {
    const it = s.faults.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (patch.status) {
      logActivity('تم تحديث حالة عطل');
      if (patch.status === 'تم الإصلاح') it.fixedAt = Date.now();
    }
    push('patch', 'faults', id, patch);
  });
}

export function deleteFault(id) {
  update((s) => {
    s.faults = s.faults.filter((x) => x.id !== id);
    logActivity('تم حذف عطل');
    push('remove', 'faults', id);
  });
}

/* ============================================================
   المناسبات
   ============================================================ */
export function addOccasion({ title, type = 'مناسبة عامة', dateMillis, note = '', recurring = 'بدون',
  reminderTime = '09:00', reminderOffsets = ['DAY'] }) {
  let created;
  update((s) => {
    created = {
      id: newId(),
      title, type,
      dateMillis: startOfDay(dateMillis),
      date: fmtDate(dateMillis),
      note, recurring,
      reminder: reminderOffsets.length ? 'مفعّل' : 'بدون تذكير',
      reminderTime,
      reminderOffsets,
      linkedItems: [],
      done: false,
      createdAt: Date.now(),
    };
    s.occasions.unshift(created);
    logActivity(`تمت إضافة مناسبة: ${title}`);
  });
  push('save', 'occasions', created);
  return created;
}

export function updateOccasion(id, patch) {
  update((s) => {
    const it = s.occasions.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (patch.dateMillis) { it.date = fmtDate(patch.dateMillis); patch = { ...patch, date: it.date }; }
    push('patch', 'occasions', id, patch);
  });
}

export function completeOccasion(id) {
  update((s) => {
    const it = s.occasions.find((x) => x.id === id);
    if (!it) return;
    if (it.recurring === 'سنويًا') {
      const d = new Date(it.dateMillis);
      d.setFullYear(d.getFullYear() + 1);
      it.dateMillis = startOfDay(d.getTime());
      logActivity(`تم تجديد مناسبة سنوية: ${it.title}`);
      push('patch', 'occasions', id, { dateMillis: it.dateMillis });
    } else {
      it.done = true;
      it.doneAt = Date.now();
      logActivity('تم إنهاء مناسبة');
      push('patch', 'occasions', id, { done: true });
    }
  });
}

export function deleteOccasion(id) {
  update((s) => {
    s.occasions = s.occasions.filter((x) => x.id !== id);
    logActivity('تم حذف مناسبة');
    push('remove', 'occasions', id);
  });
}

/* ============================================================
   أفراد البيت
   ============================================================ */
export function addMember({ name, role = 'عضو', phone = '' }) {
  update((s) => {
    s.members.push({ id: nextId(s.members), name, role, phone, isOnline: false, isOwner: false, local: true });
    logActivity(`تمت إضافة عضو: ${name}`);
  });
}

export function removeMember(id) {
  const target = state.members.find((m) => m.id === id);
  update((s) => {
    s.members = s.members.filter((m) => m.id !== id || m.isOwner);
    logActivity('تم إزالة عضو');
  });
  if (target?.uid) push('removeMember', null, target.uid);
}

export function updateProfile(patch) {
  update((s) => {
    Object.assign(s.profile, patch);
    const me = s.members.find((m) => m.isOwner) || s.members[0];
    if (me) {
      if (patch.name) me.name = patch.name;
      if (patch.role) me.role = patch.role;
      if (patch.phone !== undefined) me.phone = patch.phone;
    }
  });
  push('profile', null, patch);
}

/* ============================================================
   التصنيفات
   ============================================================ */
export function addCategory({ name, icon, type }) {
  const cat = { id: newId(), name, icon: icon || '📦', type };
  update((s) => { s.categories.push(cat); });
  push('save', 'categories', cat);
}
export function removeCategory(id) {
  update((s) => { s.categories = s.categories.filter((c) => c.id !== id); });
  push('remove', 'categories', id);
}
export const categoriesOf = (type) => state.categories.filter((c) => c.type === type);

/* ============================================================
   الإعدادات والإشعارات
   ============================================================ */
export function setNotification(key, value) {
  update((s) => { s.notifications[key] = value; });
  push('prefs', null, state.notifications);
}
export function setDarkMode(on) {
  update((s) => { s.settings.darkMode = on; });
}

/* ============================================================
   قيم محسوبة
   ============================================================ */
export function homeCounts() {
  const s = state;
  return {
    shopping: s.shopping.filter((i) => i.status !== 'تم الشراء').length,
    faults: s.faults.filter((f) => f.status !== 'تم الإصلاح').length,
    occasions: s.occasions.filter((o) => !o.done && o.dateMillis >= todayStart()).length,
  };
}

export function priorityItems() {
  const s = state;
  const out = [];
  s.shopping.filter((i) => i.priority === 'ضروري' && i.status !== 'تم الشراء')
    .forEach((i) => out.push({ kind: 'shopping', id: i.id, icon: '🛒', title: i.name, tag: 'ضروري', tone: 'danger' }));
  s.faults.filter((f) => f.priority === 'عاجل' && f.status !== 'تم الإصلاح')
    .forEach((f) => out.push({ kind: 'fault', id: f.id, icon: '🔧', title: f.title, tag: 'عاجل', tone: 'danger' }));
  s.occasions.filter((o) => !o.done && o.dateMillis >= todayStart() && o.dateMillis <= todayStart() + 3 * 86400000)
    .forEach((o) => out.push({ kind: 'occasion', id: o.id, icon: '🎉', title: o.title, tag: 'قريبًا', tone: 'warn' }));
  return out.slice(0, 6);
}

export function profileStats() {
  const s = state;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const purchased = s.shopping.filter((i) => i.status === 'تم الشراء');
  return {
    shoppingAdded: s.shopping.length,
    shoppingDone: purchased.length,
    faultsReported: s.faults.length,
    faultsFixed: s.faults.filter((f) => f.status === 'تم الإصلاح').length,
    occasionsTotal: s.occasions.length,
    monthlySpent: purchased.filter((i) => (i.purchasedAt || i.createdAt) >= monthStart)
      .reduce((a, i) => a + (i.priceValue || 0), 0),
    totalSpent: purchased.reduce((a, i) => a + (i.priceValue || 0), 0),
    totalFaultCost: s.faults.reduce((a, f) => a + (f.actualCost || f.estimatedCost || 0), 0),
  };
}

export function archiveItems() {
  const s = state;
  return {
    shopping: s.shopping.filter((i) => i.status === 'تم الشراء'),
    faults: s.faults.filter((f) => f.status === 'تم الإصلاح'),
    occasions: s.occasions.filter((o) => o.done || o.dateMillis < todayStart()),
  };
}

/* ============================================================
   بيانات تجريبية اختيارية
   ============================================================ */
export function seedDemo() {
  const d = (n) => todayStart() + n * 86400000;
  update((s) => {
    s.shopping = [
      { id: 3, name: 'لبن', quantity: 'كامل الدسم', category: 'بقالة', priority: 'ضروري', note: '', status: 'ناقص', owner: s.profile.name || 'أنا', ownerUid: 'local', price: '1.2', priceValue: 1.2, createdAt: Date.now() },
      { id: 2, name: 'منظف أرضيات', quantity: '2 علبة', category: 'منظفات', priority: 'عادي', note: '', status: 'قيد الشراء', owner: s.profile.name || 'أنا', ownerUid: 'local', price: '2.5', priceValue: 2.5, createdAt: Date.now() - 3600e3 },
      { id: 1, name: 'خضار', quantity: '', category: 'خضار وفواكه', priority: 'مهم', note: '', status: 'تم الشراء', owner: s.profile.name || 'أنا', ownerUid: 'local', price: '4', priceValue: 4, createdAt: Date.now() - 86400e3, purchasedAt: Date.now() - 80000e3 },
    ];
    s.faults = [
      { id: 1, title: 'تسريب في الحنفية', location: 'المطبخ', priority: 'عاجل', status: 'جديد', note: 'يحتاج متابعة وشراء قطع', linkedItems: [], photoUrl: '', ownerUid: 'local', estimatedCost: 15, actualCost: 0, createdAt: Date.now() - 7200e3 },
    ];
    s.occasions = [
      { id: 1, title: 'عيد ميلاد سارة', type: 'عيد ميلاد', dateMillis: d(12), note: 'شراء هدية وكيك', recurring: 'سنويًا', reminder: 'مفعّل', reminderTime: '09:00', reminderOffsets: ['WEEK', 'DAY'], linkedItems: [], done: false, createdAt: Date.now() },
      { id: 2, title: 'فاتورة الكهرباء', type: 'فاتورة', dateMillis: d(3), note: '', recurring: 'شهريًا', reminder: 'مفعّل', reminderTime: '10:00', reminderOffsets: ['DAY'], linkedItems: [], done: false, createdAt: Date.now() },
    ];
    logActivity('تم تحميل بيانات تجريبية');
  });
}
