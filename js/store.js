/* ============================================================
   طبقة البيانات — تخزين محلي أوفلاين أولًا
   نفس نماذج البيانات المستخدمة في تطبيق أندرويد "بيتنا"
   ============================================================ */

import { nextId, uid, todayStart, startOfDay } from './util.js';

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
export function setupHousehold({ householdName, memberName, email = '', joinCode = '' }) {
  update((s) => {
    s.onboarded = true;
    s.profile.name = memberName;
    s.profile.email = email;
    s.profile.joinedAt = Date.now();
    s.profile.isOwner = !joinCode;
    s.profile.role = joinCode ? 'عضو' : 'مالك البيت';
    s.household.name = householdName || `بيت ${memberName}`;
    s.household.inviteCode = joinCode || generateInviteCode();
    s.household.createdAt = Date.now();
    s.members = [{
      id: 1, name: memberName, role: s.profile.role, phone: '',
      isOnline: true, isOwner: s.profile.isOwner,
    }];
    logActivity(joinCode ? `انضم ${memberName} إلى البيت` : `تم إنشاء ${s.household.name}`);
  });
}

export function signOut() {
  update((s) => { s.onboarded = false; });
}

/* ============================================================
   المشتريات
   ============================================================ */
export function addShopping({ name, quantity = '', category = '', priority = 'عادي', note = '', price = '' }) {
  let created;
  update((s) => {
    created = {
      id: nextId(s.shopping),
      name, quantity, category, priority, note,
      status: 'ناقص',
      owner: s.profile.name || 'أنا',
      ownerUid: 'local',
      price: String(price ?? ''),
      priceValue: parseFloat(price) || 0,
      createdAt: Date.now(),
    };
    s.shopping.unshift(created);
    logActivity(`تمت إضافة عنصر: ${name}`);
  });
  return created;
}

export function updateShopping(id, patch) {
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (patch.price !== undefined) it.priceValue = parseFloat(patch.price) || 0;
    if (patch.status) logActivity('تم تحديث عنصر مشتريات');
  });
}

export function setShoppingStatus(id, status) {
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    it.status = status;
    if (status === 'تم الشراء') it.purchasedAt = Date.now();
    logActivity(`${status}: ${it.name}`);
  });
}

export function deleteShopping(id) {
  update((s) => {
    s.shopping = s.shopping.filter((x) => x.id !== id);
    logActivity('تم حذف عنصر');
  });
}

export function saveFavoriteList(name, icon, items) {
  update((s) => {
    s.favoriteLists.unshift({
      id: nextId(s.favoriteLists), name, icon: icon || '⭐',
      items: items.map((i) => ({ name: i.name, quantity: i.quantity, category: i.category })),
      updatedAt: Date.now(),
    });
    logActivity(`تم حفظ قائمة مفضلة: ${name}`);
  });
}

export function deleteFavoriteList(id) {
  update((s) => { s.favoriteLists = s.favoriteLists.filter((x) => x.id !== id); });
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
      id: nextId(s.faults),
      title, location, priority, note,
      status: 'جديد',
      linkedItems: [],
      photoUrl,
      ownerUid: 'local',
      estimatedCost: Number(estimatedCost) || 0,
      actualCost: 0,
      createdAt: Date.now(),
    };
    s.faults.unshift(created);
    logActivity(`تم تسجيل عطل: ${title}`);
  });
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
  });
}

export function deleteFault(id) {
  update((s) => {
    s.faults = s.faults.filter((x) => x.id !== id);
    logActivity('تم حذف عطل');
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
      id: nextId(s.occasions),
      title, type,
      dateMillis: startOfDay(dateMillis),
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
  return created;
}

export function updateOccasion(id, patch) {
  update((s) => {
    const it = s.occasions.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
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
    } else {
      it.done = true;
      it.doneAt = Date.now();
      logActivity('تم إنهاء مناسبة');
    }
  });
}

export function deleteOccasion(id) {
  update((s) => {
    s.occasions = s.occasions.filter((x) => x.id !== id);
    logActivity('تم حذف مناسبة');
  });
}

/* ============================================================
   أفراد البيت
   ============================================================ */
export function addMember({ name, role = 'عضو', phone = '' }) {
  update((s) => {
    s.members.push({ id: nextId(s.members), name, role, phone, isOnline: false, isOwner: false });
    logActivity(`تمت إضافة عضو: ${name}`);
  });
}

export function removeMember(id) {
  update((s) => {
    s.members = s.members.filter((m) => m.id !== id || m.isOwner);
    logActivity('تم إزالة عضو');
  });
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
}

/* ============================================================
   التصنيفات
   ============================================================ */
export function addCategory({ name, icon, type }) {
  update((s) => { s.categories.push({ id: nextId(s.categories), name, icon: icon || '📦', type }); });
}
export function removeCategory(id) {
  update((s) => { s.categories = s.categories.filter((c) => c.id !== id); });
}
export const categoriesOf = (type) => state.categories.filter((c) => c.type === type);

/* ============================================================
   الإعدادات والإشعارات
   ============================================================ */
export function setNotification(key, value) {
  update((s) => { s.notifications[key] = value; });
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
