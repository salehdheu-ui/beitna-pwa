/* ============================================================
   خادم "بيتنا" — حسابات ومزامنة، مستضاف ذاتيًا بالكامل
   بدون أي مكتبات خارجية. مزوّد الترجمة اختياري ولا يوقف الكتابة عند تعطّله.
   البيانات في ملف JSON داخل مجلد دائم (/data).
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const push = require('./push.js');
const { createTranslator, normalizeLang, FIELDS: TRANSLATION_FIELDS } = require('./translate.js');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
/* جلسة افتراضية قصيرة نسبيًا. يمكن للمشغّل تقليلها أكثر، لكن لا نسمح
   بقيمة تتجاوز 30 يومًا حتى لا يعيد إعدادٌ خاطئ جلسات السنة القديمة. */
const TOKEN_DAYS = Math.min(30, Math.max(1, Number(process.env.TOKEN_DAYS || 14)));
const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'mailto:admin@beitna.local';
const SERVER_VERSION = '1.11.1';

/* لوحة الإدارة المنفصلة لها رمز مستقل تمامًا عن حسابات بيتنا.

   لا قيمة افتراضية هنا إطلاقًا. المستودع عام، وبصمة مكتوبة في الكود
   تُكسَر خارج الخادم بسرعة غير محدودة — حدّ المحاولات لا يحمي منها لأن
   المهاجم لا يحتاج الخادم أصلًا. فإن لم يُضبط المتغيّر تُغلق اللوحة. */
const ADMIN_PANEL_CODE_HASH = String(process.env.ADMIN_PANEL_CODE_HASH || '')
  .trim().toLowerCase();
const ADMIN_PANEL_READY = /^[0-9a-f]{64}$/.test(ADMIN_PANEL_CODE_HASH);
if (!ADMIN_PANEL_READY) {
  console.warn('لوحة الإدارة مغلقة: اضبط ADMIN_PANEL_CODE_HASH (بصمة sha256 بالحروف الكبيرة).');
}
const ADMIN_PANEL_HOURS = 12;

/* بريد المشرفين (يفصل بينها فاصلة). بدونها لا يرى أحد إحصائيات النظام. */
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
);

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- مفتاح التوقيع: يُولَّد ذاتيًا مرة واحدة ---------- */
let SECRET;
try {
  SECRET = fs.readFileSync(SECRET_FILE);
} catch {
  SECRET = crypto.randomBytes(48);
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

/* ============================================================
   قاعدة البيانات والنسخ الاحتياطي
   كل البيانات في ملف JSON واحد. لذلك:
   1) ملف تالف لا يُفسَّر أبدًا كقاعدة فارغة — كان ذلك يمحو كل شيء
      عند أول حفظ بعد أي كتابة مقطوعة أو خطأ قرص.
   2) نسخة احتياطية دورية تُدوَّر تلقائيًا داخل المجلد الدائم.
   ============================================================ */
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 24);
const BACKUP_HOURS = Number(process.env.BACKUP_HOURS || 1);
/* يُضبط على مجلد مركّب من قرص/خادم آخر. تركه فارغًا يبقي النسخ المحلية
   لكنه يُظهر تحذيرًا واضحًا عند الإقلاع ولا يوهم المشغّل بوجود off-site. */
const OFFSITE_BACKUP_DIR = String(process.env.OFFSITE_BACKUP_DIR || '').trim();

fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (OFFSITE_BACKUP_DIR) fs.mkdirSync(OFFSITE_BACKUP_DIR, { recursive: true });
else console.warn('⚠️  OFFSITE_BACKUP_DIR غير مضبوط — النسخ الاحتياطية محلية فقط.');

const blank = () => ({ users: {}, emails: {}, households: {}, codes: {}, helperCodes: {}, translationCache: {} });

const fillMissing = (o) => {
  for (const k of Object.keys(blank())) if (!o[k]) o[k] = {};
  return o;
};

/** أحدث النسخ الاحتياطية أولًا */
function backupFiles(dir = BACKUP_DIR) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch { return []; }
}

/** يكتب نسخة ثم يقرأها ويفسّرها قبل اعتبار العملية ناجحة. */
function writeVerifiedBackup(dir, name) {
  const file = path.join(dir, name);
  const tmp = file + '.tmp';
  const payload = JSON.stringify(db);
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  const parsed = fillMissing(JSON.parse(fs.readFileSync(tmp, 'utf8')));
  if (!parsed.users || !parsed.households) throw new Error('backup-verification-failed');
  fs.renameSync(tmp, file);
  return file;
}

function rotateBackups(dir) {
  backupFiles(dir).slice(BACKUP_KEEP).forEach((f) => {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* تجاهل */ }
  });
}

function loadDb() {
  let raw;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('لا توجد قاعدة بيانات — تشغيل أول، نبدأ فارغة');
      return blank();
    }
    throw e;                       // قرص غير قابل للقراءة: نتوقف بدل أن نمحو
  }

  try {
    return fillMissing(JSON.parse(raw));
  } catch {
    /* الملف موجود لكنه لا يُفسَّر — لا نبدأ فارغين مهما كان */
    console.error('⚠️  قاعدة البيانات تالفة. نحاول أحدث نسخة احتياطية...');
    for (const f of backupFiles()) {
      try {
        const parsed = fillMissing(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')));
        const aside = DB_FILE + '.corrupt-' + Date.now();
        try { fs.renameSync(DB_FILE, aside); } catch { /* تجاهل */ }
        console.error(`✅ استُعيدت من ${f}. الملف التالف محفوظ في ${path.basename(aside)}`);
        return parsed;
      } catch { /* نجرّب الأقدم */ }
    }
    console.error('لا توجد نسخة احتياطية صالحة. التشغيل بقاعدة فارغة سيكتب فوق الملف ويمحو كل شيء.');
    console.error(`نتوقف هنا. افحص ${DB_FILE} يدويًا ثم أعد التشغيل.`);
    process.exit(1);
  }
}

let db = loadDb();

const translator = createTranslator({
  cache: db.translationCache,
  apiUrl: String(process.env.TRANSLATION_API_URL || 'https://api.mymemory.translated.net/get'),
  enabled: String(process.env.TRANSLATION_ENABLED || '1') !== '0',
  timeoutMs: Math.min(10000, Math.max(1000, Number(process.env.TRANSLATION_TIMEOUT_MS || 5000))),
});

let writesSinceBackup = 0;

/** نسخة احتياطية مدوَّرة. لا تُكتب إن لم يتغيّر شيء. */
function backupNow(reason = 'دوري', force = false) {
  if (!force && !writesSinceBackup) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `db-${stamp}.json`;
  try {
    const file = writeVerifiedBackup(BACKUP_DIR, name);
    if (OFFSITE_BACKUP_DIR) {
      writeVerifiedBackup(OFFSITE_BACKUP_DIR, name);
      rotateBackups(OFFSITE_BACKUP_DIR);
    }
    writesSinceBackup = 0;
    /* التدوير: نبقي أحدث BACKUP_KEEP فقط */
    rotateBackups(BACKUP_DIR);
    console.log(`نسخة احتياطية (${reason}): ${path.basename(file)}`);
    return file;
  } catch (e) {
    console.error('تعذّرت النسخة الاحتياطية', e);
    return null;
  }
}

let saveTimer = null, saving = false, dirty = false;
function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 300);
}
function flush() {
  saveTimer = null;
  if (saving || !dirty) return;
  saving = true; dirty = false;
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
    writesSinceBackup++;
  } catch (e) { console.error('فشل الحفظ', e); dirty = true; }
  saving = false;
  if (dirty) save();
}
function shutdown() { flush(); backupNow('إيقاف', true); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setInterval(flush, 5000).unref();

/* نسخة عند الإقلاع: نقطة رجوع معروفة السلامة.
   لا تُكتب إن كانت آخر نسخة أحدث من ساعة، وإلا طرد النشرُ المتكررُ
   النسخَ القديمة الصالحة بنسخ متطابقة. */
(() => {
  const newest = backupFiles()[0];
  let fresh = false;
  if (newest) {
    try { fresh = Date.now() - fs.statSync(path.join(BACKUP_DIR, newest)).mtimeMs < 3600000; }
    catch { fresh = false; }
  }
  if (!fresh) backupNow('إقلاع', true);
})();
setInterval(() => backupNow('دوري'), Math.max(1, BACKUP_HOURS) * 3600000).unref();

/* ---------- أدوات ---------- */
const now = () => Date.now();
const uid8 = () => crypto.randomBytes(12).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeInviteCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const code = 'BEITNA-' + s;
    if (!db.codes[code]) return code;
  }
  return 'BEITNA-' + uid8().slice(0, 6).toUpperCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return 's1$' + salt.toString('hex') + '$' + dk.toString('hex');
}
function verifyPassword(password, stored) {
  try {
    const [v, saltHex, dkHex] = String(stored).split('$');
    if (v !== 's1') return false;
    const dk = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(dk, Buffer.from(dkHex, 'hex'));
  } catch { return false; }
}

/* ============================================================
   رمز الاسترداد
   الخادم بلا بريد ولا أي تبعية خارجية، فلا يمكن إرسال رابط تصفير.
   البديل: رمز يُعرض مرة واحدة عند التسجيل ويُخزَّن مبصومًا فقط —
   من فقد كلمة مروره يستعيد حسابه به.
   ============================================================ */
function makeRecoveryCode() {
  const part = () => Array.from({ length: 5 },
    () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** يولّد رمزًا جديدًا، يحفظ بصمته في المستخدم، ويرجع الرمز مرة واحدة */
function issueRecoveryCode(user) {
  const code = makeRecoveryCode();
  user.recovery = hashPassword(normCode(code));
  user.recoveryAt = Date.now();
  return code;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
function signToken(uid) {
  const epoch = db.users[uid]?.tokenEpoch || 0;
  const issuedAt = now();
  const body = b64(JSON.stringify({ u: uid, i: issuedAt, e: issuedAt + TOKEN_DAYS * 864e5, v: epoch }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(token) {
  try {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(good);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    /* الرموز القديمة بلا وقت إصدار تُرفض عند نشر سياسة الجلسات الجديدة،
       ولا يستطيع إعداد قديم إبقاء جلسة أطول من الحد الحالي. */
    if (!p.u || !p.i || !p.e || p.e < now() || p.e - p.i > TOKEN_DAYS * 864e5) return null;
    /* بعد تصفير كلمة المرور تُرفع الحقبة فتسقط كل الجلسات القديمة */
    if ((db.users[p.u]?.tokenEpoch || 0) !== (p.v || 0)) return null;
    return p.u;
  } catch { return null; }
}

function validAdminPanelCode(value) {
  if (!ADMIN_PANEL_READY) return false;
  try {
    const incoming = crypto.createHash('sha256')
      .update(String(value || '').trim().toUpperCase())
      .digest();
    const expected = Buffer.from(ADMIN_PANEL_CODE_HASH, 'hex');
    return expected.length === incoming.length && crypto.timingSafeEqual(expected, incoming);
  } catch { return false; }
}

function signAdminPanelToken() {
  const body = b64(JSON.stringify({ a: 'admin-panel', e: now() + ADMIN_PANEL_HOURS * 3600000 }));
  const sig = crypto.createHmac('sha256', SECRET).update('admin:' + body).digest('base64url');
  return body + '.' + sig;
}

function readAdminPanelToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return false;
    const good = crypto.createHmac('sha256', SECRET).update('admin:' + body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(good);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.a === 'admin-panel' && payload.e > now();
  } catch { return false; }
}

function authAdminPanel(req) {
  if (!ADMIN_PANEL_READY) return false;
  const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return readAdminPanelToken(h);
}

/* ---------- حماية بسيطة من المحاولات المتكررة ---------- */
const attempts = new Map();
function tooMany(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (now() - rec.at > 15 * 60000) { attempts.delete(key); return false; }
  return rec.n >= 12;
}
function noteAttempt(key, ok) {
  if (ok) { attempts.delete(key); return; }
  const rec = attempts.get(key) || { n: 0, at: now() };
  rec.n++; rec.at = now();
  attempts.set(key, rec);
}
setInterval(() => {
  for (const [k, v] of attempts) if (now() - v.at > 15 * 60000) attempts.delete(k);
}, 60000).unref();

/* ============================================================
   Web Push — الإشعارات والتطبيق مغلق
   ============================================================ */
const VAPID = push.loadVapid(DATA_DIR);

const subsOf = (u) => (Array.isArray(u.pushSubs) ? u.pushSubs : (u.pushSubs = []));

/** ساعات الهدوء تُحترم على الخادم أيضًا، لا في الواجهة فقط */
function inQuietHours(u) {
  if (!u.prefs || u.prefs.quietHours !== true) return false;
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

/**
 * يرسل إلى كل أجهزة المستخدم، ويحذف الاشتراكات الميتة.
 * لا ينتظر الردّ: الكتابة يجب ألا تتأخّر بسبب خدمة الدفع.
 */
async function pushToUser(u, payload) {
  const subs = subsOf(u);
  if (!subs.length || inQuietHours(u)) return;

  const results = await Promise.all(subs.map((sub) =>
    push.sendPush(sub, payload, VAPID, { subject: PUSH_SUBJECT })
      .then((r) => ({ sub, r }))
      .catch(() => ({ sub, r: { ok: false, status: 0 } }))));

  const dead = results.filter(({ r }) => r.status === 404 || r.status === 410);
  if (dead.length) {
    u.pushSubs = subs.filter((sub) => !dead.some((d) => d.sub.endpoint === sub.endpoint));
    save();
  }
}

const PUSH_COL_NAMES = { shopping: 'المشتريات', faults: 'الأعطال', occasions: 'التذكيرات' };
const PUSH_ONE = {
  shopping: (d) => '🛒 أُضيف للمشتريات: ' + (d.name || ''),
  faults: (d) => '🔧 عطل جديد: ' + (d.title || ''),
  occasions: (d) => '🔔 تذكير جديد: ' + (d.title || ''),
};

/** صيغة العدد بالعربية: المثنى، ثم جمع القلة، ثم التمييز المفرد */
const countWord = (n, dual, few, many) =>
  (n === 2 ? dual : n <= 10 ? `${n} ${few}` : `${n} ${many}`);

/* إشعارات السحابة تُنشأ لكل مستلم بلغته المحفوظة. محتوى العاملة له نسختان
   محفوظتان، لذلك يصل اسم الصنف أو العطل بالعربية أو الإنجليزية للمستلم. */
const PUSH_LANG = {
  ar: { app:'بيتنا', add:'إضافة', update:'تحديث', shopping:'المشتريات', faults:'الأعطال', occasions:'التذكيرات' },
  en: { app:'Beitna', add:'Added', update:'Updated', shopping:'Shopping', faults:'Repairs', occasions:'Reminders' },
  hi: { app:'बैतना', add:'जोड़ा गया', update:'अपडेट', shopping:'खरीदारी', faults:'मरम्मत', occasions:'याद दिलाना' },
  si: { app:'බෙයිත්නා', add:'එක් කළා', update:'යාවත්කාලීන කළා', shopping:'බඩු', faults:'අලුත්වැඩියා', occasions:'මතක් කිරීම්' },
  ta: { app:'பைத்னா', add:'சேர்க்கப்பட்டது', update:'புதுப்பிக்கப்பட்டது', shopping:'பொருட்கள்', faults:'பழுது', occasions:'நினைவூட்டல்கள்' },
  am: { app:'ቤይትና', add:'ተጨምሯል', update:'ተዘምኗል', shopping:'ግዢ', faults:'ጥገና', occasions:'ማስታወሻዎች' },
  tl: { app:'Beitna', add:'Idinagdag', update:'In-update', shopping:'Pamimili', faults:'Sira', occasions:'Mga paalala' },
  id: { app:'Beitna', add:'Ditambahkan', update:'Diperbarui', shopping:'Belanja', faults:'Perbaikan', occasions:'Pengingat' },
  my: { app:'Beitna', add:'ထည့်ပြီး', update:'ပြင်ဆင်ပြီး', shopping:'ဈေးဝယ်စာရင်း', faults:'ပြုပြင်ရန်', occasions:'သတိပေးချက်' },
  sw: { app:'Beitna', add:'Imeongezwa', update:'Imesasishwa', shopping:'Manunuzi', faults:'Matengenezo', occasions:'Vikumbusho' },
  ne: { app:'Beitna', add:'थपियो', update:'अद्यावधिक भयो', shopping:'किनमेल', faults:'मर्मत', occasions:'सम्झना' },
};

function localizedPush(payload, user) {
  const lang = String(user?.prefs?.language || 'ar');
  const tr = PUSH_LANG[lang] || PUSH_LANG.ar;
  const meta = payload?._i18n;
  if (!meta) return { ...payload, lang, dir: lang === 'ar' ? 'rtl' : 'ltr' };
  const one = meta.items?.[0];
  const col = one?.col || 'shopping';
  const item = one?.data || one?.doc || {};
  const field = Object.prototype.hasOwnProperty.call(item, 'name') ? 'name' : 'title';
  const name = item?.translations?.[lang]?.[field] || item?.[field] || '';
  const action = meta.kind === 'added' ? tr.add : tr.update;
  const body = meta.items.length === 1
    ? `${action} — ${tr[col] || tr.shopping}${name ? `: ${name}` : ''}`
    : `${action} — ${meta.items.length}`;
  return {
    title: `${tr.app} — ${meta.who || ''}`.replace(/\s+—\s*$/, ''), body,
    tag: payload.tag, url: lang === 'ar' || lang === 'en' ? payload.url : './#/helper',
    lang, dir: lang === 'ar' ? 'rtl' : 'ltr',
  };
}

/**
 * إشعار واحد لكل دفعة كتابة، لا إشعار لكل عنصر — وإلا وصلت
 * عشرات الإشعارات دفعة واحدة عند إضافة قائمة أو رفع طابور متراكم.
 */
function activityPayload(added, actor) {
  const notifiable = added.filter((x) => PUSH_ONE[x.col]);
  if (!notifiable.length) return null;

  const who = actor.displayName || 'أحد أفراد البيت';
  if (notifiable.length === 1) {
    const { col, data } = notifiable[0];
    return { title: 'بيتنا — ' + who, body: PUSH_ONE[col](data), tag: 'beitna-activity', url: './#/' + col,
      _i18n: { kind: 'added', items: notifiable, who } };
  }
  const cols = [...new Set(notifiable.map((x) => x.col))];
  const n = notifiable.length;
  const body = cols.length === 1
    ? `➕ أُضيفت ${countWord(n, 'عنصران', 'عناصر', 'عنصرًا')} إلى ${PUSH_COL_NAMES[cols[0]]}`
    : `🏡 ${countWord(n, 'إضافتان جديدتان', 'إضافات جديدة', 'إضافة جديدة')}`;
  return { title: 'بيتنا — ' + who, body, tag: 'beitna-activity', url: './#/home',
    _i18n: { kind: 'added', items: notifiable, who } };
}

/* نصّ التكفّل والإنجاز — الفائدة الحقيقية: ألّا يشتري اثنان الشيء نفسه */
const ACT_TEXT = {
  claim:   (title) => '🙋 تكفّل بـ: ' + title,
  unclaim: (title) => '↩️ تراجع عن: ' + title,
  done:    (title) => '✅ أنجز: ' + title,
  reopen:  (title) => '🔄 أعاد فتح: ' + title,
  status:  (title, to) => `🔁 ${title} → ${to}`,
};

function actsPayload(acts, actor) {
  const list = acts.filter((x) => ACT_TEXT[x.act]);
  if (!list.length) return null;
  const who = actor.displayName || 'أحد أفراد البيت';
  const nameOf = (d) => d.name || d.title || 'عنصر';

  if (list.length === 1) {
    const { col, doc, act } = list[0];
    return {
      title: 'بيتنا — ' + who,
      body: ACT_TEXT[act](nameOf(doc), doc.status || ''),
      tag: 'beitna-act',
      url: './#/' + col,
      _i18n: { kind: 'updated', items: list, who },
    };
  }
  return {
    title: 'بيتنا — ' + who,
    body: `🏡 ${countWord(list.length, 'تحديثان', 'تحديثات', 'تحديثًا')} على عناصر البيت`,
    tag: 'beitna-act',
    url: './#/home',
    _i18n: { kind: 'updated', items: list, who },
  };
}

/** يُبلّغ بقية أفراد البيت بما أضافه غيرهم */
function pushHouseholdActivity(hh, actorUid, payload) {
  if (!payload) return;
  for (const m of Object.values(hh.members)) {
    if (m.deleted || m.uid === actorUid) continue;
    const target = db.users[m.uid];
    if (!target) continue;
    pushToUser(target, localizedPush(payload, target)).catch(() => { /* لا يوقف الكتابة */ });
  }
}

/* ---------- حدّ المعدل حسب مصدر الطلب ---------- */
const hits = new Map();
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}
/** يرجع true إذا تجاوز المصدر الحدّ المسموح داخل النافذة الزمنية */
function rateLimited(key, limit, windowMs) {
  const t = now();
  const rec = hits.get(key);
  if (!rec || t - rec.at > windowMs) { hits.set(key, { n: 1, at: t }); return false; }
  rec.n++;
  return rec.n > limit;
}
setInterval(() => {
  const t = now();
  for (const [k, v] of hits) if (t - v.at > 3600000) hits.delete(k);
}, 300000).unref();

/* ---------- المجموعات ---------- */
const COLS = ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists', 'pantry', 'pantryCategories'];

const DEFAULT_CATEGORIES = [
  [1, 'بقالة', '🛒', 'Shopping'], [2, 'منظفات', '🧴', 'Shopping'],
  [3, 'خضار وفواكه', '🥬', 'Shopping'], [4, 'لحوم', '🥩', 'Shopping'],
  [5, 'صيدلية', '💊', 'Shopping'], [6, 'المطبخ', '🍳', 'FaultLocation'],
  [7, 'الصالة', '🛋️', 'FaultLocation'], [8, 'غرفة النوم', '🛏️', 'FaultLocation'],
  [9, 'الحمام', '🚿', 'FaultLocation'], [10, 'غرفة الغسيل', '🧺', 'FaultLocation'],
  /* 11: تصنيف مُلغى — المعرّف متروك فلا يُعاد استعماله */
  [12, 'فاتورة', '💡', 'OccasionType'],
  [13, 'صيانة دورية', '🔧', 'OccasionType'], [14, 'مناسبة عائلية', '👨‍👩‍👧', 'OccasionType'],
];

function newHousehold(name, user, memberName) {
  const id = uid8();
  const code = makeInviteCode();
  const t = now();
  const hh = {
    id, name: name || 'بيتي', inviteCode: code, createdBy: user.uid,
    ownerName: memberName, createdAt: t, updatedAt: t,
    members: {}, cols: {},
  };
  COLS.forEach((c) => { hh.cols[c] = {}; });
  hh.members[user.uid] = {
    uid: user.uid, name: memberName || user.displayName || 'مستخدم', email: user.email || '',
    role: 'مالك البيت', isOwner: true, perm: 'owner',
    joinedAt: t, updatedAt: t, deleted: false,
  };
  DEFAULT_CATEGORIES.forEach(([cid, cname, icon, type]) => {
    hh.cols.categories[String(cid)] = {
      id: cid, name: cname, icon, type, createdAt: t, updatedAt: t, deleted: false,
    };
  });
  db.households[id] = hh;
  db.codes[code] = id;
  return hh;
}

/* ---------- HTTP ---------- */
function send(res, status, obj) {
  const body = JSON.stringify(obj ?? {});
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-max-age': '86400',
  });
  res.end(body);
}
const fail = (res, status, code) => send(res, status, { error: code });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > 2e6) { reject(new Error('too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const uid = readToken(h.replace(/^Bearer\s+/i, ''));
  if (!uid) return null;
  return db.users[uid] || null;
}

function myHousehold(user) {
  const hh = user.householdId ? db.households[user.householdId] : null;
  if (!hh) return null;
  const m = hh.members[user.uid];
  if (!m || m.deleted) return null;
  return hh;
}

const publicUser = (u, token) => ({
  ...(token ? { token } : {}), uid: u.uid, email: u.email, displayName: u.displayName,
  householdId: u.householdId || null,
});

const normEmail = (e) => String(e || '').trim().toLowerCase();

/* ============================================================
   الأدوار والصلاحيات
   owner  : مالك البيت — كل شيء
   member : فرد من العائلة — كل شيء عدا إدارة الأعضاء
   helper : العاملة — المشتريات والإبلاغ عن الأعطال فقط،
            بلا تذكيرات ولا أسعار ولا بيانات الأفراد
   ============================================================ */
const PERMS = ['owner', 'member', 'helper'];
const PRICE_FIELDS = ['price', 'priceValue', 'budget', 'cost'];

/** الأدوار القديمة لا تحمل perm — نشتقّه من isOwner */
const permOf = (m) => (m && PERMS.includes(m.perm) ? m.perm : (m && m.isOwner ? 'owner' : 'member'));
const roleLabel = (perm) =>
  (perm === 'owner' ? 'مالك البيت' : perm === 'helper' ? 'العاملة' : 'عضو');

/* ============================================================
   الصلاحيات المفصّلة
   لكل مجموعة مستوى: none (لا يراها) | read (يقرأ فقط) | write
   ولكل راية نعم/لا. الدور مجرد قالب جاهز، والمالك يعدّل فوقه
   لكل فرد على حدة من لوحة التحكم.
   ============================================================ */
const CAP_COLS = ['shopping', 'faults', 'occasions'];

/* قائمة الاحتياجات امتداد للمشتريات، فتتبع صلاحيتها ولا تلتفّ عليها */
const capLevel = (caps, col) =>
  (col === 'pantry' || col === 'pantryCategories'
    ? caps.shopping
    : (CAP_COLS.includes(col) ? caps[col] : 'write'));
const CAP_LEVELS = ['none', 'read', 'write'];
const CAP_FLAGS = ['prices', 'members', 'invite', 'remove'];

const CAP_PRESETS = {
  owner:  { shopping: 'write', faults: 'write', occasions: 'write',
            prices: true,  members: true,  invite: true,  remove: true },
  member: { shopping: 'write', faults: 'write', occasions: 'write',
            prices: true,  members: true,  invite: false, remove: true },
  helper: { shopping: 'write', faults: 'write', occasions: 'none',
            prices: false, members: false, invite: false, remove: false },
};

/** يقبل ما يفهمه فقط — أي مفتاح أو قيمة غريبة تُهمل */
function sanitizeCaps(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of CAP_COLS) if (CAP_LEVELS.includes(raw[c])) out[c] = raw[c];
  for (const f of CAP_FLAGS) if (typeof raw[f] === 'boolean') out[f] = raw[f];
  return out;
}

/** صلاحيات فرد: قالب دوره ثم تعديلات المالك فوقه. المالك لا يُقيَّد أبدًا. */
function capsOf(m) {
  const perm = permOf(m);
  const base = CAP_PRESETS[perm] || CAP_PRESETS.member;
  if (perm === 'owner') return { ...base };
  const caps = { ...base, ...sanitizeCaps(m && m.caps) };
  /* هذه حدود أمنية للدور وليست خيارات واجهة. حتى لو بقيت تعديلات قديمة
     في قاعدة البيانات، لا تحصل العاملة على الكود أو بيانات الأسرة/الأسعار. */
  if (perm === 'helper') return {
    ...caps,
    occasions: 'none', prices: false, members: false, invite: false, remove: false,
  };
  return caps;
}

function sensitiveLimited(req, user, action, limit = 10, windowMs = 3600000) {
  return rateLimited(`${action}:ip:${clientIp(req)}`, limit, windowMs)
    || rateLimited(`${action}:user:${user.uid}`, limit, windowMs);
}

/* ============================================================
   سلسلة العهدة — من طلب، ومن تكفّل، ومن أنجز.
   يختمها الخادم من هوية صاحب الطلب، ولا يُقرأ أيّ منها مما
   يرسله الجهاز؛ وإلا نسب أيّ أحد فعلَ غيره إلى نفسه.
   ============================================================ */
const TRAIL_MAX = 24;
const STAMPED = ['createdBy', 'claimedBy', 'claimedAt', 'doneBy', 'doneAt', 'trail'];
const ACTS = ['claim', 'unclaim', 'done', 'reopen', 'status', 'edit', 'create'];

/** ينزع كل حقول النسبة مما أرسله الجهاز — الخادم وحده يكتبها */
function stripStamped(d) {
  const o = { ...(d || {}) };
  for (const f of STAMPED) delete o[f];
  return o;
}

function trailPush(doc, by, act, to) {
  const prev = Array.isArray(doc.trail) ? doc.trail : [];
  const entry = { at: now(), by, act };
  if (to) entry.to = String(to).slice(0, 40);
  doc.trail = [...prev, entry].slice(-TRAIL_MAX);
}

/**
 * يضع النسبة على العنصر بعد دمج ما أرسله الجهاز.
 * `prev` قد يكون غير موجود (عنصر جديد). يرجع الفعل المسجَّل أو null.
 */
function stampDoc(doc, prev, act, uid) {
  doc.createdBy = (prev && prev.createdBy) || uid;

  if (act === 'claim') {
    doc.claimedBy = uid; doc.claimedAt = now();
    trailPush(doc, uid, 'claim');
    return 'claim';
  }
  if (act === 'unclaim') {
    doc.claimedBy = null; doc.claimedAt = 0;
    trailPush(doc, uid, 'unclaim');
    return 'unclaim';
  }
  if (act === 'done') {
    doc.doneBy = uid; doc.doneAt = now();
    trailPush(doc, uid, 'done', doc.status);
    return 'done';
  }
  if (act === 'reopen') {
    doc.doneBy = null; doc.doneAt = 0;
    trailPush(doc, uid, 'reopen');
    return 'reopen';
  }
  if (!prev) { trailPush(doc, uid, 'create'); return 'create'; }

  /* تغيّرت الحالة دون فعل صريح — نسجّلها كما هي */
  if (doc.status && prev.status && doc.status !== prev.status) {
    trailPush(doc, uid, 'status', doc.status);
    return 'status';
  }
  return null;   /* تعديل عادي: لا نُثقل السجل به */
}

/* ============================================================
   تخصيص الأقسام: يسمّي المالك أقسام بيته ويختار أيقوناتها.
   الاسم نص قصير، والأيقونة محرفان على الأكثر (إيموجي واحد).
   نخزّن ما يفهمه الخادم فقط، فلا يتسلل HTML من هنا إلى الأجهزة.
   ============================================================ */
const UI_SECTIONS = ['home', 'shopping', 'faults', 'occasions', 'more'];

function sanitizeUi(raw) {
  const sections = {};
  const src = (raw && typeof raw === 'object' && raw.sections) || {};
  for (const key of UI_SECTIONS) {
    const s = src[key];
    if (!s || typeof s !== 'object') continue;
    const out = {};
    if (typeof s.label === 'string' && s.label.trim()) {
      out.label = s.label.trim().replace(/[<>]/g, '').slice(0, 24);
    }
    if (typeof s.icon === 'string' && s.icon.trim()) {
      out.icon = [...s.icon.trim()].slice(0, 2).join('');
    }
    if (Object.keys(out).length) sections[key] = out;
  }
  return Object.keys(sections).length ? { sections } : null;
}

/** ينزع الأسعار من عنصر مشتريات قبل إرساله للعاملة */
function stripPrices(doc) {
  const out = { ...doc };
  for (const f of PRICE_FIELDS) delete out[f];
  return out;
}

const isAdmin = (u) => !!u && ADMIN_EMAILS.has(String(u.email || '').toLowerCase());

/**
 * يحذف المستخدم من كل بيوته ثم يحذف حسابه.
 * إن كان مالكًا وبقي أعضاء: تنتقل الملكية لأقدم عضو باقٍ حتى لا تضيع بيانات غيره.
 * إن كان آخر عضو: يُحذف البيت وبياناته وكود دعوته.
 */
function deleteUser(user) {
  let householdsDeleted = 0, ownershipTransferred = 0;

  for (const hh of Object.values(db.households)) {
    const m = hh.members[user.uid];
    if (!m) continue;
    const wasOwner = !!m.isOwner;
    delete hh.members[user.uid];

    const remaining = Object.values(hh.members).filter((x) => !x.deleted);
    if (!remaining.length) {
      if (hh.inviteCode) delete db.codes[hh.inviteCode];
      delete db.households[hh.id];
      householdsDeleted++;
      continue;
    }
    if (wasOwner) {
      const heir = remaining.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
      heir.isOwner = true;
      heir.role = 'مالك البيت';
      heir.updatedAt = now();
      ownershipTransferred++;
    }
    hh.updatedAt = now();
  }

  const email = String(user.email || '').toLowerCase();
  if (email && db.emails[email] === user.uid) delete db.emails[email];
  delete db.users[user.uid];

  return { householdsDeleted, ownershipTransferred };
}

/** أرقام مجمّعة فقط — لا بريد ولا اسم ولا محتوى */
function buildStats() {
  const users = Object.values(db.users);
  const households = Object.values(db.households);
  const t = now();
  const since = (days) => t - days * 86400000;

  const activeSince = (days) => users.filter((u) => (u.updatedAt || u.createdAt || 0) > since(days)).length;

  const items = {};
  let itemsTotal = 0;
  for (const c of COLS) items[c] = 0;
  for (const hh of households) {
    for (const c of COLS) {
      const live = Object.values(hh.cols?.[c] || {}).filter((d) => !d.deleted).length;
      items[c] += live;
      itemsTotal += live;
    }
  }

  const members = households.map((hh) => Object.values(hh.members).filter((m) => !m.deleted).length);
  const membersTotal = members.reduce((a, b) => a + b, 0);
  const pushDevices = users.reduce((sum, u) => sum + (Array.isArray(u.pushSubs) ? u.pushSubs.length : 0), 0);
  const usersWithoutHousehold = users.filter((u) => !u.householdId || !db.households[u.householdId]).length;
  const signupsDaily = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(t - (6 - i) * 86400000);
    const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const end = start + 86400000;
    return {
      date: new Date(start).toISOString().slice(0, 10),
      count: users.filter((u) => (u.createdAt || 0) >= start && (u.createdAt || 0) < end).length,
    };
  });
  let dbBytes = 0;
  try { dbBytes = fs.statSync(DB_FILE).size; } catch { /* لم يُحفظ بعد */ }

  const backups = backupFiles();
  let lastBackup = 0;
  if (backups[0]) { try { lastBackup = fs.statSync(path.join(BACKUP_DIR, backups[0])).mtimeMs; } catch { /* تجاهل */ } }

  return {
    version: SERVER_VERSION,
    backups: backups.length,
    lastBackupAt: lastBackup,
    users: users.length,
    usersWithoutHousehold,
    pushDevices,
    activeUsers24h: activeSince(1),
    usersNew7d: users.filter((u) => (u.createdAt || 0) > since(7)).length,
    usersNew30d: users.filter((u) => (u.createdAt || 0) > since(30)).length,
    activeUsers7d: activeSince(7),
    activeUsers30d: activeSince(30),
    households: households.length,
    householdsShared: members.filter((n) => n > 1).length,
    householdsSolo: members.filter((n) => n === 1).length,
    membersTotal,
    avgMembers: households.length ? Number((members.reduce((a, b) => a + b, 0) / households.length).toFixed(2)) : 0,
    signupsDaily,
    items, itemsTotal,
    dbBytes,
    uptimeSec: Math.round(process.uptime()),
    at: t,
  };
}

/* ---------- المسارات ---------- */
async function route(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;

  if (p === '/health') return send(res, 200, { ok: true, version: SERVER_VERSION, at: now() });

  /* المفتاح العام لـ VAPID — يحتاجه المتصفح قبل الاشتراك */
  if (p === '/push/key' && method === 'GET') return send(res, 200, { key: VAPID.publicKey });

  /* ===== حساب جديد ===== */
  if (p === '/signup' && method === 'POST') {
    /* بلا هذا الحدّ يستطيع أي أحد إنشاء حسابات بلا نهاية حتى يمتلئ القرص */
    if (rateLimited('signup:' + clientIp(req), 5, 3600000)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    const email = normEmail(b.email);
    const password = String(b.password || '');
    const displayName = String(b.displayName || '').trim() || email.split('@')[0];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'invalid-email');
    if (password.length < 6) return fail(res, 400, 'weak-password');
    if (db.emails[email]) return fail(res, 409, 'email-already-in-use');
    const uid = uid8();
    db.users[uid] = {
      uid, email, displayName, pass: hashPassword(password),
      householdId: null, createdAt: now(), updatedAt: now(), prefs: {},
    };
    db.emails[email] = uid;
    const recoveryCode = issueRecoveryCode(db.users[uid]);
    save();
    /* يُعرض مرة واحدة فقط — لا يُخزَّن على الخادم إلا مبصومًا */
    return send(res, 200, { ...publicUser(db.users[uid], signToken(uid)), recoveryCode });
  }

  /* ===== تسجيل الدخول ===== */
  if (p === '/login' && method === 'POST') {
    const b = await readBody(req);
    const email = normEmail(b.email);
    const password = String(b.password || '');
    if (!email || !password) return fail(res, 400, 'invalid-email');
    /* الحدّ حسب البريد يمنع تخمين كلمة حسابٍ بعينه. وهذا الحدّ حسب المصدر
       يمنع الوجه الآخر: كلمةٌ واحدة تُجرَّب على آلاف البُرد من مكان واحد. */
    if (tooMany(email) || rateLimited('login:' + clientIp(req), 60, 3600000)) {
      return fail(res, 429, 'too-many-requests');
    }
    const uid = db.emails[email];
    const u = uid ? db.users[uid] : null;
    /* ردٌّ واحد للحالتين: «لا يوجد حساب» كان يكشف من يملك حسابًا عندنا
       لمن يجرّب البُرد واحدًا واحدًا. ونحسب بصمةً وهمية حين لا يوجد
       الحساب، وإلا لكشفَ فرقُ الزمن ما أخفاه الردّ. */
    if (!u) {
      hashPassword(password);
      noteAttempt(email, false);
      return fail(res, 401, 'invalid-credentials');
    }
    if (!verifyPassword(password, u.pass)) { noteAttempt(email, false); return fail(res, 401, 'invalid-credentials'); }
    noteAttempt(email, true);
    return send(res, 200, publicUser(u, signToken(uid)));
  }

  /* ===== استعادة الحساب برمز الاسترداد ===== */
  if (p === '/account/recover' && method === 'POST') {
    if (rateLimited('recover:' + clientIp(req), 8, 3600000)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    const email = normEmail(b.email);
    const code = normCode(b.code);
    const password = String(b.password || '');
    if (password.length < 6) return fail(res, 400, 'weak-password');
    if (tooMany('rec:' + email)) return fail(res, 429, 'too-many-requests');

    const u = db.users[db.emails[email]];
    /* ردّ واحد لكل الحالات حتى لا يُستدلّ على البرد المسجَّلة */
    if (!u || !u.recovery || !verifyPassword(code, u.recovery)) {
      noteAttempt('rec:' + email, false);
      return fail(res, 401, 'bad-recovery');
    }
    noteAttempt('rec:' + email, true);

    u.pass = hashPassword(password);
    u.tokenEpoch = (u.tokenEpoch || 0) + 1;      // تسقط كل الجلسات القديمة
    u.updatedAt = now();
    const recoveryCode = issueRecoveryCode(u);   // الرمز يُستهلك ويُستبدل
    save();
    return send(res, 200, { ...publicUser(u, signToken(u.uid)), recoveryCode });
  }

  /* ===== لوحة الإدارة المستقلة — لا علاقة لها بحسابات أو أدوار أفراد البيت ===== */
  if (p === '/admin/login' && method === 'POST') {
    if (!ADMIN_PANEL_READY) return fail(res, 503, 'admin-not-configured');
    const key = 'admin-panel:' + clientIp(req);
    if (tooMany(key) || rateLimited(key, 20, 3600000)) return fail(res, 429, 'too-many-requests');
    const body = await readBody(req);
    if (!validAdminPanelCode(body.code)) {
      noteAttempt(key, false);
      return fail(res, 401, 'wrong-admin-code');
    }
    noteAttempt(key, true);
    return send(res, 200, { token: signAdminPanelToken(), expiresHours: ADMIN_PANEL_HOURS });
  }

  if (p === '/admin/stats' && method === 'GET') {
    if (!authAdminPanel(req)) return fail(res, 401, 'admin-session-required');
    return send(res, 200, buildStats());
  }

  if (p === '/admin/backup' && method === 'POST') {
    if (!authAdminPanel(req)) return fail(res, 401, 'admin-session-required');
    flush();
    const file = backupNow('لوحة الإدارة', true);
    if (!file) return fail(res, 500, 'backup-failed');
    return send(res, 200, { ok: true, file: path.basename(file) });
  }

  /* ===== كل ما بعده يحتاج تسجيل دخول ===== */
  const user = authUser(req);
  if (!user) return fail(res, 401, 'no-user');

  if (p === '/me' && method === 'GET') {
    const hh = myHousehold(user);
    const caps = hh ? capsOf(hh.members[user.uid]) : null;
    return send(res, 200, {
      ...publicUser(user, null),
      isAdmin: isAdmin(user),
      perm: hh ? permOf(hh.members[user.uid]) : null,
      caps,
      householdId: hh ? hh.id : null,
      household: hh ? {
        id: hh.id, name: hh.name, createdAt: hh.createdAt,
        ui: hh.ui || null,
        /* كود الدعوة يضيف أعضاء للبيت — لمن يملك رايته فقط */
        inviteCode: caps && caps.invite ? hh.inviteCode : null,
      } : null,
    });
  }

  if (p === '/profile' && method === 'POST') {
    const b = await readBody(req);
    if (b.displayName) { user.displayName = String(b.displayName).slice(0, 60); user.updatedAt = now(); save(); }
    return send(res, 200, { ok: true });
  }

  /* ===== كل بيوتي ===== */
  if (p === '/households' && method === 'GET') {
    const mine = Object.values(db.households)
      .filter((hh) => hh.members[user.uid] && !hh.members[user.uid].deleted)
      .map((hh) => {
        const m = hh.members[user.uid];
        const perm = permOf(m);
        return {
          id: hh.id, name: hh.name, perm, role: roleLabel(perm),
          isOwner: perm === 'owner',
          members: Object.values(hh.members).filter((x) => !x.deleted).length,
          active: hh.id === user.householdId,
          createdAt: hh.createdAt,
        };
      })
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return send(res, 200, { households: mine });
  }

  /* ===== تبديل البيت النشط ===== */
  if (p === '/household/switch' && method === 'POST') {
    const b = await readBody(req);
    const target = db.households[String(b.id || '')];
    const m = target?.members[user.uid];
    if (!target || !m || m.deleted) return fail(res, 404, 'not-a-member');
    user.householdId = target.id; user.updatedAt = now();
    save();
    const perm = permOf(m);
    const caps = capsOf(m);
    return send(res, 200, {
      id: target.id, name: target.name, perm, role: roleLabel(perm),
      inviteCode: caps.invite ? (target.inviteCode || null) : null,
    });
  }

  /* ===== اشتراك الدفع ===== */
  if (p === '/push/subscribe' && method === 'POST') {
    const b = await readBody(req);
    const sub = b.subscription || {};
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return fail(res, 400, 'bad-subscription');
    const subs = subsOf(user);
    /* الجهاز نفسه قد يُجدّد اشتراكه — نستبدل ولا نكرّر */
    const kept = subs.filter((x) => x.endpoint !== sub.endpoint);
    kept.push({
      endpoint: String(sub.endpoint).slice(0, 1000),
      keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) },
      at: now(),
    });
    user.pushSubs = kept.slice(-8);       // ٨ أجهزة لكل حساب تكفي
    user.updatedAt = now();
    save();
    return send(res, 200, { ok: true, devices: user.pushSubs.length });
  }

  if (p === '/push/subscribe' && method === 'DELETE') {
    const b = await readBody(req);
    const ep = String(b.endpoint || '');
    user.pushSubs = subsOf(user).filter((x) => x.endpoint !== ep);
    save();
    return send(res, 200, { ok: true, devices: user.pushSubs.length });
  }

  /* إشعار تجريبي إلى أجهزة صاحب الحساب نفسه */
  if (p === '/push/test' && method === 'POST') {
    const subs = subsOf(user);
    if (!subs.length) return fail(res, 400, 'no-subscription');
    const lang = String(user.prefs?.language || 'ar');
    const tr = PUSH_LANG[lang] || PUSH_LANG.ar;
    const results = await Promise.all(subs.map((sub) =>
      push.sendPush(sub, {
        title: `${tr.app} ✓`,
        body: `${tr.update} ✓`,
        tag: 'beitna-test',
        lang, dir: lang === 'ar' ? 'rtl' : 'ltr',
      }, VAPID, { subject: PUSH_SUBJECT }).catch(() => ({ ok: false, status: 0 }))));
    return send(res, 200, {
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).map((r) => r.status),
    });
  }

  /* ===== رمز استرداد جديد ===== */
  if (p === '/account/recovery' && method === 'POST') {
    if (sensitiveLimited(req, user, 'new-recovery', 5)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    if (!verifyPassword(String(b.password || ''), user.pass)) return fail(res, 401, 'wrong-password');
    const recoveryCode = issueRecoveryCode(user);
    save();
    return send(res, 200, { recoveryCode });
  }

  /* ===== تغيير كلمة المرور ===== */
  if (p === '/account/password' && method === 'POST') {
    if (sensitiveLimited(req, user, 'change-password', 5)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    if (!verifyPassword(String(b.current || ''), user.pass)) return fail(res, 401, 'wrong-password');
    const next = String(b.password || '');
    if (next.length < 6) return fail(res, 400, 'weak-password');
    user.pass = hashPassword(next);
    user.tokenEpoch = (user.tokenEpoch || 0) + 1;
    user.updatedAt = now();
    save();
    /* الجلسة الحالية تحتاج رمزًا جديدًا بعد رفع الحقبة */
    return send(res, 200, { ...publicUser(user, signToken(user.uid)) });
  }

  /* ===== حذف الحساب نهائيًا =====
     يطلب كلمة المرور حتى لا يكفي رمز مسروق لمحو الحساب. */
  if (p === '/account/delete' && method === 'POST') {
    if (sensitiveLimited(req, user, 'delete-account', 5)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    if (!verifyPassword(String(b.password || ''), user.pass)) return fail(res, 401, 'wrong-password');
    const summary = deleteUser(user);
    save();
    return send(res, 200, { ok: true, ...summary });
  }

  /* ===== النسخ الاحتياطية — للمشرفين فقط ===== */
  if (p === '/backups' && method === 'GET') {
    if (!isAdmin(user)) return fail(res, 403, 'admin-only');
    const list = backupFiles().map((f) => {
      let size = 0, at = 0;
      try { const st = fs.statSync(path.join(BACKUP_DIR, f)); size = st.size; at = st.mtimeMs; }
      catch { /* حُذفت للتو */ }
      return { file: f, size, at };
    });
    return send(res, 200, { backups: list, keep: BACKUP_KEEP, everyHours: BACKUP_HOURS });
  }

  if (p === '/backups/now' && method === 'POST') {
    if (!isAdmin(user)) return fail(res, 403, 'admin-only');
    flush();
    const file = backupNow('يدوي', true);
    if (!file) return fail(res, 500, 'backup-failed');
    return send(res, 200, { ok: true, file: path.basename(file) });
  }

  /* ===== إحصائيات النظام — للمشرفين فقط، أرقام مجمّعة بلا أي بيانات شخصية ===== */
  if (p === '/stats' && method === 'GET') {
    if (!isAdmin(user)) return fail(res, 403, 'admin-only');
    return send(res, 200, buildStats());
  }

  /* ===== إنشاء بيت ===== */
  if (p === '/household' && method === 'POST') {
    if (sensitiveLimited(req, user, 'create-household', 10)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    const hh = newHousehold(String(b.name || '').slice(0, 80), user, String(b.memberName || '').slice(0, 60));
    user.householdId = hh.id; user.updatedAt = now();
    if (b.memberName) user.displayName = String(b.memberName).slice(0, 60);
    save();
    return send(res, 200, { id: hh.id, name: hh.name, inviteCode: hh.inviteCode, createdAt: hh.createdAt });
  }

  /* ===== الانضمام بكود ===== */
  if (p === '/household/join' && method === 'POST') {
    /* كود الدعوة قصير — بلا حدّ يمكن تخمينه والدخول على بيت غريب */
    if (rateLimited('join:' + clientIp(req), 10, 3600000)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    const asHelper = !!db.helperCodes[code];
    const hid = db.codes[code] || db.helperCodes[code];
    const hh = hid ? db.households[hid] : null;
    if (!hh) return fail(res, 404, 'bad-code');
    const t = now();
    const memberName = String(b.memberName || user.displayName || 'مستخدم').slice(0, 60);
    const existing = hh.members[user.uid];
    /* العضوية المحذوفة لا تُستعاد بصلاحياتها القديمة. العضو النشط فقط
       يحتفظ بدوره إذا أدخل كود البيت مرة أخرى بالخطأ. */
    const activeExisting = existing && !existing.deleted;
    const perm = activeExisting ? permOf(existing) : (asHelper ? 'helper' : 'member');
    hh.members[user.uid] = {
      uid: user.uid, name: memberName, email: user.email || '',
      role: roleLabel(perm), isOwner: perm === 'owner', perm,
      joinedAt: activeExisting ? existing.joinedAt : t, updatedAt: t, deleted: false,
      /* لا نعيد تعديلات صلاحيات عضوية محذوفة. */
      ...(activeExisting && existing.caps ? { caps: sanitizeCaps(existing.caps) } : {}),
    };
    hh.updatedAt = t;
    user.householdId = hh.id; user.displayName = memberName; user.updatedAt = t;
    save();
    const caps = capsOf(hh.members[user.uid]);
    return send(res, 200, {
      id: hh.id, name: hh.name, perm, role: roleLabel(perm), caps,
      inviteCode: caps.invite ? (hh.inviteCode || null) : null,
      createdAt: hh.createdAt,
    });
  }

  const hh = myHousehold(user);
  if (!hh) return fail(res, 404, 'no-household');

  const myPerm = permOf(hh.members[user.uid]);
  const myCaps = capsOf(hh.members[user.uid]);
  const isOwner = myPerm === 'owner';

  if (p === '/household' && method === 'GET') {
    return send(res, 200, {
      id: hh.id, name: hh.name, createdAt: hh.createdAt,
      perm: myPerm, role: roleLabel(myPerm), caps: myCaps,
      ui: hh.ui || null,
      /* كود الدعوة به تُضاف أعضاء للبيت — لا يصل من لا يملك الراية */
      inviteCode: myCaps.invite ? hh.inviteCode : null,
    });
  }

  /* ===== تخصيص الأقسام: الاسم والأيقونة — من المالك فقط ===== */
  if (p === '/household/ui' && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    const b = await readBody(req);
    hh.ui = sanitizeUi(b.ui);
    hh.updatedAt = now(); save();
    return send(res, 200, { ok: true, ui: hh.ui });
  }

  /* ===== صلاحيات فرد بالتفصيل — من المالك فقط ===== */
  if (p.startsWith('/member/') && p.endsWith('/caps') && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'member-caps', 30)) return fail(res, 429, 'too-many-requests');
    const target = decodeURIComponent(p.slice('/member/'.length, -'/caps'.length));
    const m = hh.members[target];
    if (!m || m.deleted) return fail(res, 404, 'no-member');
    /* المالك غير قابل للتقييد — ولو قُيّد لأغلق على نفسه بيته */
    if (permOf(m) === 'owner') return fail(res, 400, 'owner-unrestricted');
    const b = await readBody(req);
    const requested = sanitizeCaps(b.caps);
    /* للعاملة يمكن للمالك تقليل/توسيع وصول المشتريات والأعطال فقط.
       القدرات الحساسة ليست خيارات قابلة للرفع أصلًا. */
    m.caps = permOf(m) === 'helper'
      ? Object.fromEntries(['shopping', 'faults']
        .filter((key) => requested[key])
        .map((key) => [key, requested[key]]))
      : requested;
    m.updatedAt = now(); hh.updatedAt = now(); save();
    return send(res, 200, { ok: true, caps: capsOf(m) });
  }

  if (p === '/household/rename' && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'rename-household', 20)) return fail(res, 429, 'too-many-requests');
    const b = await readBody(req);
    if (b.name) { hh.name = String(b.name).slice(0, 80); hh.updatedAt = now(); save(); }
    return send(res, 200, { ok: true });
  }

  /* ===== كود دعوة الأسرة: تدوير أو إلغاء — من المالك فقط ===== */
  if (p === '/household/invite-code' && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'rotate-invite', 10)) return fail(res, 429, 'too-many-requests');
    if (hh.inviteCode) delete db.codes[hh.inviteCode];
    const code = makeInviteCode();
    hh.inviteCode = code;
    db.codes[code] = hh.id;
    hh.updatedAt = now(); save();
    return send(res, 200, { inviteCode: code });
  }

  if (p === '/household/invite-code' && method === 'DELETE') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'revoke-invite', 10)) return fail(res, 429, 'too-many-requests');
    if (hh.inviteCode) delete db.codes[hh.inviteCode];
    hh.inviteCode = null;
    hh.updatedAt = now(); save();
    return send(res, 200, { ok: true, inviteCode: null });
  }

  /* ===== كود دعوة خاص بالعاملة — من المالك فقط ===== */
  if (p === '/household/helper-code' && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'rotate-helper-invite', 10)) return fail(res, 429, 'too-many-requests');
    if (hh.helperCode) delete db.helperCodes[hh.helperCode];
    let code;
    do { code = makeInviteCode().replace('BEITNA-', 'AMEL-'); }
    while (db.codes[code] || db.helperCodes[code]);
    hh.helperCode = code;
    db.helperCodes[code] = hh.id;
    hh.updatedAt = now(); save();
    return send(res, 200, { helperCode: code });
  }

  if (p === '/household/helper-code' && method === 'GET') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    return send(res, 200, { helperCode: hh.helperCode || null });
  }

  if (p === '/household/helper-code' && method === 'DELETE') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'revoke-helper-invite', 10)) return fail(res, 429, 'too-many-requests');
    if (hh.helperCode) delete db.helperCodes[hh.helperCode];
    hh.helperCode = null;
    hh.updatedAt = now(); save();
    return send(res, 200, { ok: true, helperCode: null });
  }

  /* ===== تغيير دور عضو — من المالك فقط ===== */
  if (p.startsWith('/member/') && p.endsWith('/role') && method === 'POST') {
    if (!isOwner) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'member-role', 30)) return fail(res, 429, 'too-many-requests');
    const target = decodeURIComponent(p.slice('/member/'.length, -'/role'.length));
    const b = await readBody(req);
    const perm = String(b.perm || '');
    if (!PERMS.includes(perm)) return fail(res, 400, 'bad-perm');
    const m = hh.members[target];
    if (!m || m.deleted) return fail(res, 404, 'no-member');
    /* لا يجوز أن يبقى البيت بلا مالك */
    if (target === user.uid && perm !== 'owner') {
      const owners = Object.values(hh.members).filter((x) => !x.deleted && permOf(x) === 'owner');
      if (owners.length <= 1) return fail(res, 400, 'last-owner');
    }
    const roleChanged = permOf(m) !== perm;
    m.perm = perm; m.isOwner = perm === 'owner'; m.role = roleLabel(perm); m.updatedAt = now();
    if (roleChanged) m.caps = {};
    hh.updatedAt = now(); save();
    return send(res, 200, { ok: true });
  }

  /* ===== المزامنة: كل ما تغيّر بعد since ===== */
  if (p === '/sync' && method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const full = since <= 0;
    const out = {
      now: now(), full,
      household: {
        id: hh.id, name: hh.name,
        ui: hh.ui || null,
        /* كود الدعوة يضيف أعضاء للبيت — لا يصل من لا يملك الراية */
        inviteCode: myCaps.invite ? hh.inviteCode : null,
      },
      caps: myCaps,
    };
    out.cols = {};
    /* ما مستواه none لا يُرسل أصلًا، والأسعار تُنزع عمّن لا يملك رايتها */
    for (const c of COLS) {
      const level = capLevel(myCaps, c);
      if (level === 'none') { out.cols[c] = []; continue; }
      const bucket = hh.cols[c] || {};
      const list = [];
      for (const k of Object.keys(bucket)) {
        const d = bucket[k];
        if ((d.updatedAt || 0) <= since) continue;
        list.push(!myCaps.prices ? stripPrices(d) : d);
      }
      out.cols[c] = list;
    }
    /* من لا يملك راية الأفراد يرى الاسم فقط — يكفي لتمييز من أضاف ماذا */
    out.members = Object.values(hh.members)
      .filter((m) => (m.updatedAt || 0) > since)
      .map((m) => (myCaps.members
        ? m
        : { uid: m.uid, name: m.name, role: m.role, deleted: !!m.deleted, updatedAt: m.updatedAt }));
    return send(res, 200, out);
  }

/* ============================================================
   حدود المستند

   كل ما يُكتب في البيت ينزل إلى أجهزة كل أفراده في كل مزامنة، ويُحفظ
   في مساحة المتصفح المحدودة. اسم بطول 200 ألف حرف من فرد واحد كان
   يُقبل كما هو — فيُثقل البيت على الجميع ويستهلك حصّة التخزين.
   ============================================================ */
const FIELD_MAX = 400;        // النصوص العادية
const NOTE_MAX = 4000;        // الملاحظات وما يشبهها
/* صور الأعطال تُحفظ data URI بعد تصغيرها إلى 1000px وجودة 0.72 —
   أي مئات الكيلوبايتات مشروعة. حدّ 400 حرفًا كان سيمحوها. */
const IMAGE_MAX = 400000;
const LONG_FIELDS = new Set(['note', 'notes', 'description', 'details']);
const IMAGE_FIELDS = new Set(['photoUrl', 'photo', 'imageUrl', 'image']);
const DOC_FIELDS = 60;        // عدد الحقول في المستند الواحد
const ARRAY_MAX = 200;        // عناصر أي مصفوفة داخل المستند

function capDoc(data, depth = 0) {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.slice(0, ARRAY_MAX).map((x) => capValue('', x, depth + 1));
  }
  const out = {};
  let n = 0;
  for (const key of Object.keys(data)) {
    if (++n > DOC_FIELDS) break;
    out[key] = capValue(key, data[key], depth + 1);
  }
  return out;
}

function capValue(key, value, depth) {
  if (typeof value === 'string') {
    if (IMAGE_FIELDS.has(key)) return value.slice(0, IMAGE_MAX);
    return value.slice(0, LONG_FIELDS.has(key) ? NOTE_MAX : FIELD_MAX);
  }
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  return capDoc(value, depth);
}

const owns = (o, key) => Object.prototype.hasOwnProperty.call(o || {}, key);

/** إذا عدّل فرد الأسرة نصًا مترجمًا نزيل النسخة القديمة لذلك الحقل. */
function invalidateTranslations(col, patch, previous, sourceLang) {
  const changed = (TRANSLATION_FIELDS[col] || []).filter((field) => owns(patch, field));
  if (!changed.length) return patch;
  const translations = {};
  for (const [lang, values] of Object.entries(previous?.translations || {})) {
    translations[lang] = { ...(values || {}) };
    for (const field of changed) delete translations[lang][field];
  }
  return { ...patch, sourceLang: normalizeLang(sourceLang), translations };
}

  /* ===== الكتابة: دفعة عمليات ===== */
  if (p === '/write' && method === 'POST') {
    const b = await readBody(req);
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 500) : [];
    const t = now();
    let applied = 0, denied = 0;
    const added = [];        // العناصر الجديدة فقط — للإشعار
    const acts = [];         // تكفُّل وإنجاز — يُشعَر بها بقية أفراد البيت
    let translatedDocs = 0;
    for (const op of ops) {
      const col = String(op.col || '');
      if (!COLS.includes(col)) continue;

      /* الحدود تُفرض هنا، لا في الواجهة فقط:
         الكتابة تحتاج مستوى write، والحذف راية remove،
         ومن لا يرى الأسعار لا يمسّها */
      const level = capLevel(myCaps, col);
      if (level !== 'write') { denied++; continue; }
      if (op.op === 'delete' && !myCaps.remove) { denied++; continue; }
      if (op.data) op.data = capDoc(op.data);
      if (!myCaps.prices && op.data) op.data = stripPrices(op.data);

      const id = String(op.id ?? '');
      if (!id) continue;
      const bucket = hh.cols[col] || (hh.cols[col] = {});
      const prev = bucket[id];
      const isNew = !prev;
      if (op.op === 'delete') {
        const keepId = op.numericId ?? prev?.id ?? (Number(id) || id);
        bucket[id] = { ...(prev || {}), id: keepId, deleted: true, updatedAt: t };
      } else if (op.op === 'merge' && prev) {
        let patch = stripStamped(op.data);
        delete patch.translations;
        if (myPerm === 'helper' && translatedDocs < 20) {
          patch = await translator.translateDocument(col, patch, user.prefs?.language || 'ar', prev);
          if ((TRANSLATION_FIELDS[col] || []).some((field) => owns(patch, field))) translatedDocs++;
        } else if (myPerm !== 'helper') {
          patch = invalidateTranslations(col, patch, prev, user.prefs?.language || 'ar');
        }
        const doc = { ...prev, ...patch, id: prev.id, deleted: false, updatedAt: t };
        const act = ACTS.includes(op.act) ? op.act : 'edit';
        const done = stampDoc(doc, prev, act, user.uid);
        bucket[id] = doc;
        if (done && done !== 'create') acts.push({ col, doc, act: done });
      } else {
        let data = stripStamped(op.data);
        delete data.translations;
        if (myPerm === 'helper' && translatedDocs < 20) {
          data = await translator.translateDocument(col, data, user.prefs?.language || 'ar', prev);
          if ((TRANSLATION_FIELDS[col] || []).some((field) => owns(data, field))) translatedDocs++;
        } else if (myPerm !== 'helper') {
          data = invalidateTranslations(col, data, prev, user.prefs?.language || 'ar');
        }
        /* من لا يرى الأسعار لا يجوز أن يمحوها بإعادة حفظ العنصر */
        const keep = (!myCaps.prices && prev)
          ? Object.fromEntries(PRICE_FIELDS.filter((f) => f in prev).map((f) => [f, prev[f]]))
          : {};
        const doc = {
          ...(prev || {}), ...data, ...keep,
          id: data.id ?? prev?.id ?? (Number(id) || id),
          createdAt: data.createdAt || prev?.createdAt || t,
          deleted: false, updatedAt: t,
        };
        const act = ACTS.includes(op.act) ? op.act : (prev ? 'edit' : 'create');
        const done = stampDoc(doc, prev, act, user.uid);
        bucket[id] = doc;
        if (done && done !== 'create') acts.push({ col, doc, act: done });
      }
      if (isNew && op.op !== 'delete') added.push({ col, data: bucket[id] });
      applied++;
    }
    if (applied) { hh.updatedAt = t; save(); }
    if (added.length) pushHouseholdActivity(hh, user.uid, activityPayload(added, user));
    if (acts.length) pushHouseholdActivity(hh, user.uid, actsPayload(acts, user));
    return send(res, 200, { ok: true, applied, denied, now: t });
  }

  /* ===== الأعضاء ===== */
  if (p === '/members' && method === 'GET') {
    const list = Object.values(hh.members).filter((m) => !m.deleted);
    return send(res, 200, {
      members: myCaps.members
        ? list.map((m) => ({ ...m, perm: permOf(m), caps: capsOf(m) }))
        : list.map((m) => ({ uid: m.uid, name: m.name, role: m.role })),
    });
  }

  if (p === '/member' && method === 'POST') {
    const b = await readBody(req);
    const patch = b.patch || {};
    const t = now();
    const m = hh.members[user.uid] || { uid: user.uid, joinedAt: t, isOwner: false, role: 'عضو' };
    hh.members[user.uid] = {
      ...m,
      name: patch.name !== undefined ? String(patch.name).slice(0, 60) : m.name,
      phone: patch.phone !== undefined ? String(patch.phone).slice(0, 40) : (m.phone || ''),
      role: patch.role !== undefined ? String(patch.role).slice(0, 40) : m.role,
      email: m.email || user.email || '',
      deleted: false, updatedAt: t,
    };
    if (patch.name) user.displayName = String(patch.name).slice(0, 60);
    hh.updatedAt = t; save();
    return send(res, 200, { ok: true });
  }

  if (p.startsWith('/member/') && method === 'DELETE') {
    const target = decodeURIComponent(p.slice('/member/'.length));
    const me = hh.members[user.uid];
    if (permOf(me) !== 'owner' && target !== user.uid) return fail(res, 403, 'owner-only');
    if (sensitiveLimited(req, user, 'remove-member', 30)) return fail(res, 429, 'too-many-requests');
    const m = hh.members[target];
    if (!m || m.deleted) return fail(res, 404, 'no-member');
    if (permOf(m) === 'owner') {
      const owners = Object.values(hh.members).filter((x) => !x.deleted && permOf(x) === 'owner');
      if (owners.length <= 1) return fail(res, 400, 'last-owner');
    }
    m.deleted = true; m.updatedAt = now(); hh.updatedAt = now();
    if (db.users[target] && db.users[target].householdId === hh.id) db.users[target].householdId = null;
    save();
    return send(res, 200, { ok: true });
  }

  /* ===== تفضيلات الإشعارات ===== */
  if (p === '/prefs' && method === 'GET') return send(res, 200, user.prefs || {});
  if (p === '/prefs' && method === 'POST') {
    const b = await readBody(req);
    user.prefs = { ...(user.prefs || {}), ...b, updatedAt: now() };
    save();
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'not-found');
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return fail(res, 400, 'bad-url'); }
  route(req, res, url).catch((e) => {
    const m = String(e && e.message || '');
    /* جسم الطلب التالف خطأ العميل لا خطأ الخادم. الردّ بـ500 يخفي
       السبب عن العميل ويُظهر عطبًا وهميًا في سجلّات الخادم. */
    if (m === 'bad-json') return res.headersSent || fail(res, 400, 'bad-json');
    if (m === 'too-large') return res.headersSent || fail(res, 413, 'payload-too-large');
    console.error('خطأ', e);
    if (!res.headersSent) fail(res, 500, 'server-error');
  });
});

server.listen(PORT, () => console.log('خادم بيتنا يعمل على المنفذ', PORT, '— البيانات في', DATA_DIR));

