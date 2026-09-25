/* ============================================================
   طبقة البيانات — تخزين محلي أوفلاين أولًا
   نفس نماذج البيانات المستخدمة في تطبيق أندرويد "بيتنا"
   ============================================================ */

import { nextId, uid, todayStart, startOfDay, fmtDate } from './util.js';
import { PANTRY_CATEGORIES, PANTRY_SEED } from './pantry-data.js';

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
  /* المعرّف 11 كان لتصنيف مُلغى — لا يُعاد استعماله حتى لا يلتبس ببيانات قديمة */
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

/* ============================================================
   الأقسام: أسماؤها وأيقوناتها.
   هذه هي الافتراضية، ويغيّرها مالك البيت من لوحة التحكم فتُخزَّن
   في ui.sections وتصل كل الأجهزة عبر المزامنة. المفتاح الداخلي
   لا يتغيّر أبدًا (occasions يبقى occasions) حتى لا تُهاجَر بيانات.
   ============================================================ */
export const SECTION_KEYS = ['home', 'shopping', 'faults', 'occasions', 'more'];
export const DEFAULT_SECTIONS = {
  home:      { label: 'الرئيسية',  icon: '🏠' },
  shopping:  { label: 'المشتريات', icon: '🛒' },
  faults:    { label: 'الأعطال',   icon: '🔧' },
  occasions: { label: 'التذكيرات', icon: '🔔' },
  more:      { label: 'المزيد',    icon: '☰' },
};

/* صلاحيات كاملة — الجهاز الواحد بلا حساب لا يُقيَّد */
const FULL_CAPS = {
  shopping: 'write', faults: 'write', occasions: 'write',
  prices: true, members: true, invite: true, remove: true,
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
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    favoriteLists: [],
    activities: [],
    notifications: { ...DEFAULT_NOTIFICATIONS },
    settings: { darkMode: false, language: 'العربية' },
    ui: { sections: {} },
    caps: null,          // يأتي من الخادم؛ null = بلا قيود (محلي)
    pantry: [],          // قائمة الاحتياجات الدائمة — لا تُستهلك بالشراء
    pantryCategories: [], // أقسام احتياجات يضيفها أفراد البيت
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
  try { return bridge[op]?.(col, ...args); }
  catch (e) { console.warn('تعذّرت المزامنة', e); throw e; }
}

/**
 * معرّف رقمي يتوافق مع نوع Int في تطبيق الأندرويد.
 *
 * الصيغة «الدقائق × 100 + عشوائي 0–99» لا تملك إلا مئة معرّف في الدقيقة،
 * فأي إضافة جماعية في اللحظة نفسها — استيراد قائمة الاحتياجات، تطبيق قائمة
 * محفوظة، إرسال الناقص إلى المشتريات — كانت تتصادم فيها المعرّفات ويضيع
 * جزء من العناصر بصمت (216 صنفًا كانت تنزل إلى نحو 150).
 *
 * الحلّ: علامة ماء عليا محفوظة على الجهاز. لا يُسلَّم معرّف يساوي أو يقل
 * عمّا سُلِّم قبله، فيستحيل التصادم داخل الجهاز — ولو صدرت آلاف العناصر
 * في المللي ثانية نفسها. والعشوائي يبقى ليباعد بين الأجهزة.
 */
const K_SEQ = 'beitna:seq';
let issued = 0;
try { issued = Number(localStorage.getItem(K_SEQ) || 0) || 0; } catch { /* تجاهل */ }

export function newId() {
  const minutes = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60000);
  let id = minutes * 100 + Math.floor(Math.random() * 100);
  if (id <= issued) id = issued + 1;
  issued = id;
  try { localStorage.setItem(K_SEQ, String(issued)); } catch { /* تجاهل */ }
  return id;
}

/**
 * يرفع العلامة فوق كل معرّف موجود فعلًا.
 * العلامة وحدها لا تكفي: بيانات وصلت من جهاز آخر — أو استيراد قديم —
 * قد تحمل أرقامًا أعلى مما سلّمه هذا الجهاز، فتُصادمها الإضافات الجديدة
 * ويُطمس القديم. نمرّ على كل ما يصل ونرفع العلامة فوق أعلاه.
 */
export function reserveIds(items) {
  let max = issued;
  for (const it of items || []) {
    const id = it && it.id;
    if (typeof id === 'number' && id > max) max = id;
  }
  if (max <= issued) return;
  issued = max;
  try { localStorage.setItem(K_SEQ, String(issued)); } catch { /* تجاهل */ }
}

/** يستبدل مجموعة قادمة من السحابة دون إعادة إرسالها */
export function applyRemote(collection, items) {
  reserveIds(items);
  update((s) => { s[collection] = items; });
  /* الخادم ما زال يحمل التصنيف المُلغى لكل بيت أُنشئ قبل إزالته */
  if (collection === 'categories' || collection === 'occasions') dropRetiredType();
}

/* ---------- التحميل والحفظ ---------- */
let state = load();
const listeners = new Set();

/* بيانات محفوظة على الجهاز قد تحمل معرّفات أعلى من علامتنا — نرفعها فوقها */
for (const col of ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists', 'pantry', 'pantryCategories']) {
  reserveIds(state[col]);
}

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

const PERSIST_MS = 60;
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, PERSIST_MS);
}

/**
 * حفظ فوري متزامن.
 * الحفظ العادي مؤجَّل، فأي إعادة تحميل تليه مباشرة — تبديل بيت،
 * ربط جهاز، حذف حساب — قد تسبق الكتابة فتضيع.
 */
export function persistNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('تعذّر الحفظ المحلي', e); }
}

function emit() {
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

export const getState = () => state;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ---------- الأقسام: المخصَّص فوق الافتراضي ---------- */
export function sectionsOf() {
  const custom = (state.ui && state.ui.sections) || {};
  const out = {};
  for (const k of SECTION_KEYS) out[k] = { ...DEFAULT_SECTIONS[k], ...(custom[k] || {}) };
  return out;
}
export const sectionLabel = (k) => (sectionsOf()[k] || {}).label || k;
export const sectionIcon = (k) => (sectionsOf()[k] || {}).icon || '•';

/* ---------- الصلاحيات: مرآة لما يفرضه الخادم ----------
   الواجهة تُخفي فقط؛ المنع الحقيقي في الخادم. */
export const myCaps = () => state.caps || FULL_CAPS;
export const canSee = (col) => myCaps()[col] !== 'none';
export const canWrite = (col) => (myCaps()[col] || 'write') === 'write';
export const canPrices = () => myCaps().prices !== false;
export const canMembers = () => myCaps().members !== false;
export const canInvite = () => myCaps().invite !== false;
export const canRemove = () => myCaps().remove !== false;
export const amOwner = () => !!state.profile.isOwner;

/* ============================================================
   سلسلة العهدة — من طلب، من تكفّل، من أنجز.
   الخادم يختم الهوية؛ ما هنا عرضٌ وتفاؤلٌ محليّ فقط.
   ============================================================ */
export const myUid = () => cloudUid || 'local';

/** اسم صاحب المعرّف كما يعرفه البيت */
export function nameOfUid(uid) {
  if (!uid) return '';
  if (uid === myUid() || uid === 'local') return state.profile.name || 'أنا';
  const m = (state.members || []).find((x) => x.uid === uid);
  return (m && m.name) || 'أحد أفراد البيت';
}

const COL_OF = { shopping: 'shopping', faults: 'faults', occasions: 'occasions' };

/** يعيد المنتج المرتبط بالمشتريات إلى «متوفر» فور تسجيل شرائه. */
function restoreLinkedPantry(s, shopping, at = Date.now()) {
  if (!shopping || shopping.status !== 'تم الشراء') return null;
  let pantry = shopping.pantryId == null ? null
    : s.pantry.find((item) => String(item.id) === String(shopping.pantryId));
  /* توافق مع العناصر التي أُرسلت من قائمة الاحتياجات قبل إضافة الرابط الصريح. */
  if (!pantry && shopping.note === 'من قائمة الاحتياجات') {
    pantry = s.pantry.find((item) => !item.stocked && item.name === shopping.name);
  }
  if (!pantry || pantry.stocked) return null;
  pantry.stocked = true;
  pantry.updatedAt = at;
  return pantry;
}

function pushRestoredPantry(item) {
  if (item) push('patch', 'pantry', item.id, { stocked: true, updatedAt: item.updatedAt });
}

/** فعل موقَّع على عنصر: claim | unclaim | done | reopen */
export function actOnItem(col, id, act, patch = {}) {
  if (!COL_OF[col]) return;
  const mine = myUid();
  const t = Date.now();
  let restoredPantry = null;
  update((s) => {
    const it = s[col].find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (act === 'claim') { it.claimedBy = mine; it.claimedAt = t; }
    if (act === 'unclaim') { it.claimedBy = ''; it.claimedAt = 0; }
    if (act === 'done') { it.doneBy = mine; it.doneAt = t; }
    if (act === 'reopen') { it.doneBy = ''; it.doneAt = 0; }
    if (col === 'shopping' && (act === 'done' || patch.status === 'تم الشراء')) {
      restoredPantry = restoreLinkedPantry(s, it, t);
    }
    /* السجل المعروض قبل وصول ختم الخادم — يُستبدل بما يرسله عند المزامنة */
    it.trail = [...(it.trail || []), { at: t, by: mine, act, ...(patch.status ? { to: patch.status } : {}) }].slice(-24);
  });
  push('act', col, id, act, patch);
  pushRestoredPantry(restoredPantry);
}

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
  inviteCode = '', isOwner = null, cloud = false, resetData = false }) {
  const owner = isOwner === null ? !joinCode : isOwner;
  update((s) => {
    s.onboarded = true;
    s.profile.name = memberName;
    s.profile.email = email;
    s.profile.joinedAt = Date.now();
    s.profile.isOwner = owner;
    s.profile.role = owner ? 'مالك البيت' : 'عضو';
    s.household.name = householdName || `بيت ${memberName}`;
    /* كود الانضمام ليس بالضرورة كود الأسرة (قد يكون كود العاملة).
       في الوضع السحابي لا نخترع ولا نحفظ أي كود لم يُعده الخادم. */
    s.household.inviteCode = cloud ? (inviteCode || '') : (inviteCode || joinCode || generateInviteCode());
    s.household.createdAt = Date.now();
    s.household.cloud = cloud;
    if (!cloud) {
      s.members = [{
        id: 1, name: memberName, role: s.profile.role, phone: '',
        isOnline: true, isOwner: owner,
      }];
    }
    /* لا نمسح البيانات إلا عند إنشاء بيت جديد أو الانضمام لبيت آخر */
    if (resetData) {
      s.shopping = []; s.faults = []; s.occasions = []; s.favoriteLists = [];
      s.pantry = []; s.pantryCategories = []; s.activities = [];
    }
    logActivity(joinCode || !owner ? `انضم ${memberName} إلى البيت` : `تم إنشاء ${s.household.name}`);
  });
}

let logoutHook = null;
export function setLogoutHook(fn) { logoutHook = fn; }

/**
 * تسجيل الخروج.
 * keepData: يُبقي بيانات الجهاز (مشتريات وأعطال وتذكيرات وتصنيفات)
 * ويُخرج الهوية فقط — يُستخدم عند ربط جهاز محلي بحساب سحابي،
 * فالمسح هناك يعني فقدان كل ما أدخله المستخدم قبل الربط.
 */
export function signOut({ keepData = false } = {}) {
  try { logoutHook?.(); } catch (e) { console.warn(e); }
  const keepSettings = { ...state.settings };
  const carried = keepData ? {
    shopping: state.shopping, faults: state.faults, occasions: state.occasions,
    categories: state.categories, favoriteLists: state.favoriteLists,
    pantry: state.pantry, pantryCategories: state.pantryCategories,
    activities: state.activities,
    profile: { ...blankState().profile, name: state.profile.name },
  } : null;

  state = blankState();
  state.settings = keepSettings;
  if (carried) Object.assign(state, carried);
  emit();
}

/**
 * يرفع كل ما على هذا الجهاز إلى البيت السحابي الحالي.
 * يُستدعى بعد ربط جهاز كان يعمل بلا حساب. يرجع عدد ما رُفع.
 */
export function uploadLocalData() {
  if (mode !== 'cloud' || !bridge) return 0;
  let n = 0;
  for (const col of ['categories', 'shopping', 'faults', 'occasions', 'favoriteLists', 'pantry', 'pantryCategories']) {
    for (const item of state[col] || []) {
      try { bridge.save(col, item); n++; } catch (e) { console.warn('تعذّر رفع عنصر', e); }
    }
  }
  return n;
}

/* ============================================================
   المشتريات
   ============================================================ */
export function addShopping({ name, quantity = '', category = '', priority = 'عادي', note = '', price = '', sourceLang = '', translations = {}, pantryId = null }) {
  let created;
  update((s) => {
    created = {
      id: newId(),
      name, quantity, category, priority, note, sourceLang, translations, pantryId,
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
  let restoredPantry = null;
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (patch.price !== undefined) it.priceValue = parseFloat(patch.price) || 0;
    if (patch.status) logActivity('تم تحديث عنصر مشتريات');
    if (patch.status === 'تم الشراء') restoredPantry = restoreLinkedPantry(s, it);
    push('patch', 'shopping', id, { ...patch, priceValue: it.priceValue });
  });
  pushRestoredPantry(restoredPantry);
}

/** يمسح بيانات البيت السابق بعد نجاح دخول حساب مختلف، دون إبطال جلسة
    الحساب الجديد التي استلمناها للتو من الخادم. */
export function prepareAccountSwitch() {
  const settings = { ...state.settings };
  state = blankState();
  state.settings = settings;
  setCloudBridge(null, null);
  setCloudUid(null);
  emit();
  persistNow();
}

export function setShoppingStatus(id, status) {
  let restoredPantry = null;
  let purchasedAt = 0;
  update((s) => {
    const it = s.shopping.find((x) => x.id === id);
    if (!it) return;
    it.status = status;
    if (status === 'تم الشراء') it.purchasedAt = purchasedAt = Date.now();
    restoredPantry = restoreLinkedPantry(s, it, purchasedAt || Date.now());
    logActivity(`${status}: ${it.name}`);
    push('patch', 'shopping', id, { status, ...(purchasedAt ? { purchasedAt } : {}) });
  });
  pushRestoredPantry(restoredPantry);
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

/** قائمة فارغة تُبنى من الصفر — دون المرور بجلسة تسوق */
export function createFavoriteList(name = 'قائمة جديدة', icon = '⭐') {
  const list = { id: newId(), name, icon: icon || '⭐', items: [], updatedAt: Date.now() };
  update((s) => {
    s.favoriteLists.unshift(list);
    logActivity(`تم إنشاء قائمة: ${name}`);
  });
  push('save', 'favoriteLists', list);
  return list;
}

/** حفظ القائمة كما هي بعد أي تعديل */
function commitFavoriteList(id) {
  const list = state.favoriteLists.find((x) => x.id === id);
  if (!list) return null;
  list.updatedAt = Date.now();
  push('save', 'favoriteLists', list);
  return list;
}

export function renameFavoriteList(id, name, icon) {
  update((s) => {
    const l = s.favoriteLists.find((x) => x.id === id);
    if (!l) return;
    if (name !== undefined && String(name).trim()) l.name = String(name).trim().slice(0, 40);
    if (icon !== undefined && String(icon).trim()) l.icon = [...String(icon).trim()].slice(0, 2).join('');
  });
  return commitFavoriteList(id);
}

export function addFavoriteItem(id, { name, quantity = '', category = '' }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  update((s) => {
    const l = s.favoriteLists.find((x) => x.id === id);
    if (l) l.items.push({ name: clean.slice(0, 60), quantity: String(quantity).trim().slice(0, 30), category });
  });
  return commitFavoriteList(id);
}

export function removeFavoriteItem(id, index) {
  update((s) => {
    const l = s.favoriteLists.find((x) => x.id === id);
    if (l && index >= 0 && index < l.items.length) l.items.splice(index, 1);
  });
  return commitFavoriteList(id);
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
export function addFault({ title, location = '', priority = 'متوسط', note = '', photoUrl = '', estimatedCost = 0, sourceLang = '' }) {
  let created;
  update((s) => {
    created = {
      id: newId(),
      title, location, priority, note, sourceLang,
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
   التذكيرات
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
    logActivity(`تمت إضافة تذكير: ${title}`);
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
      logActivity(`تم تجديد تذكير سنوي: ${it.title}`);
      push('patch', 'occasions', id, { dateMillis: it.dateMillis });
    } else {
      it.done = true;
      it.doneAt = Date.now();
      logActivity('تم إنهاء تذكير');
      push('patch', 'occasions', id, { done: true });
    }
  });
}

export function deleteOccasion(id) {
  update((s) => {
    s.occasions = s.occasions.filter((x) => x.id !== id);
    logActivity('تم حذف تذكير');
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
  if (target?.uid) return push('removeMember', null, target.uid);
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
   تصنيف مُلغى
   أُزيل من التطبيق، لكنه يبقى محفوظًا في كل بيت أُنشئ قبل الإلغاء
   ويعود مع كل مزامنة — فلا يكفي حذفه من القائمة الافتراضية.
   ننظّفه عند التحميل وبعد كل دفعة تصل من الخادم:
     • يُحذف من التصنيفات، والحذف يصل إلى بقية الأجهزة.
     • والتذكيرات التي تحمل نوعه تنتقل إلى «مناسبة عائلية».
   عناوين التذكيرات لا تُمسّ: تلك كلمات كتبها أهل البيت بأنفسهم،
   ليس لنا أن نعيد صياغتها.
   آمن ومتكرِّر: إن لم يجد شيئًا لم يفعل شيئًا ولم يُرسل شيئًا.
   ============================================================ */
/* الاسم المُلغى يُكتب هنا وحده، ولا لزوم له في أي موضع آخر */
const RETIRED_OCCASION_TYPE = 'عيد ميلاد';
const RETIRED_FALLBACK = 'مناسبة عائلية';

export function dropRetiredType() {
  const gone = state.categories.filter((c) => c.name === RETIRED_OCCASION_TYPE);
  const moved = state.occasions.filter((o) => o.type === RETIRED_OCCASION_TYPE).map((o) => o.id);
  if (!gone.length && !moved.length) return 0;
  update((s) => {
    s.categories = s.categories.filter((c) => c.name !== RETIRED_OCCASION_TYPE);
    for (const o of s.occasions) {
      if (o.type !== RETIRED_OCCASION_TYPE) continue;
      o.type = RETIRED_FALLBACK;
      o.updatedAt = Date.now();
    }
  });
  gone.forEach((c) => push('remove', 'categories', c.id));
  state.occasions.filter((o) => moved.includes(o.id)).forEach((o) => push('save', 'occasions', o));
  return gone.length + moved.length;
}

/* ونظّفه من النسخة المحفوظة على الجهاز قبل أول رسمة.
   النداء هنا لا فوق: الثابت أعلاه لا يوجد قبل سطره، فنداءٌ مبكّر
   يُسقط الوحدة كلها ومعها التطبيق. */
dropRetiredType();

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
    .forEach((i) => out.push({ kind: 'shopping', id: i.id, icon: '🛒', title: i.name, source: i, field: 'name', tag: 'ضروري', tone: 'danger' }));
  s.faults.filter((f) => f.priority === 'عاجل' && f.status !== 'تم الإصلاح')
    .forEach((f) => out.push({ kind: 'fault', id: f.id, icon: '🔧', title: f.title, source: f, field: 'title', tag: 'عاجل', tone: 'danger' }));
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
      { id: 1, title: 'صيانة المكيّف', type: 'صيانة دورية', dateMillis: d(12), note: 'تنظيف الفلاتر قبل الصيف', recurring: 'سنويًا', reminder: 'مفعّل', reminderTime: '09:00', reminderOffsets: ['WEEK', 'DAY'], linkedItems: [], done: false, createdAt: Date.now() },
      { id: 2, title: 'فاتورة الكهرباء', type: 'فاتورة', dateMillis: d(3), note: '', recurring: 'شهريًا', reminder: 'مفعّل', reminderTime: '10:00', reminderOffsets: ['DAY'], linkedItems: [], done: false, createdAt: Date.now() },
    ];
    logActivity('تم تحميل بيانات تجريبية');
  });
}

/* ============================================================
   قائمة الاحتياجات — مخزون البيت
   قائمة دائمة لا تُستهلك بالشراء. ✓ = متوفر، وإزالة العلامة تعني
   «نفد» فيظهر في الناقص ويُرسَل إلى المشتريات بضغطة.
   منفصلة تمامًا عن المشتريات: الطلبات المستعجلة تبقى هناك.
   ============================================================ */

export function seedPantry(force = false) {
  if (!force && state.pantry.length) return 0;
  const t = Date.now();
  const items = PANTRY_SEED.map((x) => ({
    id: newId(),
    name: x.n,
    cat: x.c,
    stocked: !x.out,
    sourceLang: 'ar',
    updatedAt: t,
  }));
  update((s) => {
    /* لا نمحو ما أضافه المستخدم — نُلحق ما ليس عنده باسمه */
    const have = new Set(s.pantry.map((p) => p.name));
    s.pantry = s.pantry.concat(items.filter((x) => !have.has(x.name)));
    logActivity(`تم استيراد قائمة الاحتياجات (${items.length} صنفًا)`);
  });
  state.pantry.forEach((p) => push('save', 'pantry', p));
  return items.length;
}

/**
 * معرّفات متصادمة من قبل الإصلاح: صنفان يحملان الرقم نفسه، فالضغط على
 * أحدهما يقلب الآخر. آمن ومتكرِّر: بلا تصادم لا يفعل شيئًا.
 */
export function fixPantryIds() {
  if (!state.pantry.length) return 0;
  const seen = new Set();
  const fixed = [];
  update((s) => {
    for (const p of s.pantry) {
      if (seen.has(p.id)) { p.id = newId(); p.updatedAt = Date.now(); fixed.push(p); }
      seen.add(p.id);
    }
  });
  fixed.forEach((p) => push('save', 'pantry', p));
  return fixed.length;
}

/** أسماء القائمة الجاهزة الغائبة عن قائمتك الآن */
export const pantryMissing = () => {
  const have = new Set(state.pantry.map((p) => p.name));
  return PANTRY_SEED.filter((x) => !have.has(x.n));
};

/**
 * يُلحق الغائب من القائمة الجاهزة ولا يمسّ شيئًا قائمًا.
 * يُستدعى بضغطة المستخدم لا تلقائيًا: التلقائي يسبق أول مزامنة فيحسب
 * الناقص على قائمة نصف واصلة، فيُلحق ما لدى الخادم أصلًا أو يفوته الباقي.
 */
export function completePantry() {
  const missing = pantryMissing();
  if (!missing.length) return 0;
  const t = Date.now();
  const items = missing.map((x) => ({
    id: newId(), name: x.n, cat: x.c, stocked: !x.out, sourceLang: 'ar', updatedAt: t,
  }));
  update((s) => {
    s.pantry = s.pantry.concat(items);
    logActivity(`أُكملت قائمة الاحتياجات (${items.length} صنفًا)`);
  });
  items.forEach((p) => push('save', 'pantry', p));
  return items.length;
}

export function addPantryItem({ name, cat = 'canned', stocked = true, sourceLang = 'ar' }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const item = { id: newId(), name: clean.slice(0, 60), cat, stocked: !!stocked, sourceLang, updatedAt: Date.now() };
  update((s) => { s.pantry.unshift(item); });
  push('save', 'pantry', item);
  return item;
}

/** الأقسام الافتراضية مع ما أضافه أفراد البيت، من دون تكرار معرّف. */
export function pantryCategoriesOf() {
  const seen = new Set();
  return PANTRY_CATEGORIES.concat(state.pantryCategories || [])
    .filter((c) => {
      const id = String(c?.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    })
    .map((c) => {
      const fixed = Object.fromEntries(Object.entries(c.names || {})
        .map(([lang, name]) => [lang, { name }]));
      return {
        id: String(c.id), name: String(c.name || 'قسم').slice(0, 40),
        icon: String(c.icon || '📦').slice(0, 8), custom: !PANTRY_CATEGORIES.some((x) => x.id === String(c.id)),
        sourceLang: c.sourceLang || 'ar',
        translations: { ...fixed, ...(c.translations && typeof c.translations === 'object' ? c.translations : {}) },
      };
    });
}

export function addPantryCategory({ name, icon = '📦', sourceLang = 'ar' }) {
  const clean = String(name || '').trim().slice(0, 40);
  const mark = String(icon || '').trim().slice(0, 8) || '📦';
  if (!clean) return null;
  if (pantryCategoriesOf().some((c) => c.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase())) return null;
  const category = { id: 'custom-' + uid(), name: clean, icon: mark, sourceLang, createdAt: Date.now(), updatedAt: Date.now() };
  update((s) => { s.pantryCategories.push(category); });
  push('save', 'pantryCategories', category);
  return category;
}

/** ✓ متوفر / ✗ نفد — هذا هو الفعل اليومي في هذه الشاشة */
export function setPantryStock(id, stocked) {
  let item = null;
  update((s) => {
    const p = s.pantry.find((x) => x.id === id);
    if (!p) return;
    p.stocked = !!stocked;
    p.updatedAt = Date.now();
    item = p;
  });
  /* الحالة وحدها تتغيّر. إرسال المستند كاملًا كان يجعل الخادم يعتبر الاسم
     معدّلًا، فيحذف ترجماته ثم يعود النص إلى لغة المصدر. */
  if (item) push('patch', 'pantry', id, { stocked: item.stocked, updatedAt: item.updatedAt });
  return item;
}

export function removePantryItem(id) {
  update((s) => { s.pantry = s.pantry.filter((x) => x.id !== id); });
  push('remove', 'pantry', id);
}

export function renamePantryItem(id, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  let item = null;
  update((s) => {
    const p = s.pantry.find((x) => x.id === id);
    if (!p) return;
    p.name = clean.slice(0, 60);
    p.updatedAt = Date.now();
    item = p;
  });
  if (item) push('save', 'pantry', item);
  return item;
}

/** تعديل الاسم والقسم معًا من شاشة قائمة الاحتياجات. */
export function updatePantryItem(id, { name, cat, sourceLang }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  let item = null;
  update((s) => {
    const p = s.pantry.find((x) => x.id === id);
    if (!p) return;
    p.name = clean.slice(0, 60);
    if (cat !== undefined && cat !== null && String(cat)) p.cat = String(cat);
    if (sourceLang) p.sourceLang = sourceLang;
    p.updatedAt = Date.now();
    item = p;
  });
  if (item) push('save', 'pantry', item);
  return item;
}

/** ما نفد — مرتّبًا على الأقسام */
export const pantryNeeded = () => state.pantry.filter((p) => !p.stocked);

/**
 * يرسل الناقص إلى المشتريات، ويتخطّى ما هو مضاف هناك أصلًا ولم يُشترَ بعد
 * حتى لا تتكرر الأسماء عند كل مراجعة.
 */
export function sendNeededToShopping() {
  const needed = pantryNeeded();
  if (!needed.length) return 0;
  const pending = new Set(
    state.shopping.filter((i) => i.status !== 'تم الشراء').map((i) => i.name)
  );
  let added = 0;
  for (const p of needed) {
    if (pending.has(p.name)) continue;
    addShopping({
      name: p.name, category: '', note: 'من قائمة الاحتياجات',
      sourceLang: p.sourceLang || 'ar', translations: p.translations || {}, pantryId: p.id,
    });
    added++;
  }
  if (added) logActivity(`أُرسل ${added} صنفًا من الاحتياجات إلى المشتريات`);
  return added;
}

/** يرسل صنفًا واحدًا عند تعليم العاملة أنه نفد، من دون إنشاء نسخة مكررة. */
export function sendPantryItemToShopping(id) {
  const p = state.pantry.find((item) => item.id === id);
  if (!p || p.stocked) return 0;
  const exists = state.shopping.some((item) => item.status !== 'تم الشراء' && item.name === p.name);
  if (exists) return 0;
  addShopping({
    name: p.name, category: '', note: 'من قائمة الاحتياجات',
    sourceLang: p.sourceLang || 'ar', translations: p.translations || {}, pantryId: p.id,
  });
  logActivity(`أُرسل ${p.name} من الاحتياجات إلى المشتريات`);
  return 1;
}

/** مراجعة دورية: يُعيد كل شيء إلى «متوفر» لتبدأ جولة جديدة */
export function resetPantryReview() {
  const t = Date.now();
  update((s) => { s.pantry.forEach((p) => { p.stocked = true; p.updatedAt = t; }); });
  state.pantry.forEach((p) => push('patch', 'pantry', p.id, { stocked: true, updatedAt: t }));
}

