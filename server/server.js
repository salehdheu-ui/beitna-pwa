/* ============================================================
   خادم "بيتنا" — حسابات ومزامنة، مستضاف ذاتيًا بالكامل
   بدون أي اعتماد على طرف خارجي. بدون أي مكتبات خارجية.
   البيانات في ملف JSON داخل مجلد دائم (/data).
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const TOKEN_DAYS = 400;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- مفتاح التوقيع: يُولَّد ذاتيًا مرة واحدة ---------- */
let SECRET;
try {
  SECRET = fs.readFileSync(SECRET_FILE);
} catch {
  SECRET = crypto.randomBytes(48);
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

/* ---------- قاعدة البيانات ---------- */
const blank = () => ({ users: {}, emails: {}, households: {}, codes: {} });
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  for (const k of Object.keys(blank())) if (!db[k]) db[k] = {};
} catch { db = blank(); }

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
  } catch (e) { console.error('فشل الحفظ', e); dirty = true; }
  saving = false;
  if (dirty) save();
}
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });
setInterval(flush, 5000).unref();

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

const b64 = (s) => Buffer.from(s).toString('base64url');
function signToken(uid) {
  const body = b64(JSON.stringify({ u: uid, e: now() + TOKEN_DAYS * 864e5 }));
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
    if (!p.u || !p.e || p.e < now()) return null;
    return p.u;
  } catch { return null; }
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

/* ---------- المجموعات ---------- */
const COLS = ['shopping', 'faults', 'occasions', 'categories', 'favoriteLists'];

const DEFAULT_CATEGORIES = [
  [1, 'بقالة', '🛒', 'Shopping'], [2, 'منظفات', '🧴', 'Shopping'],
  [3, 'خضار وفواكه', '🥬', 'Shopping'], [4, 'لحوم', '🥩', 'Shopping'],
  [5, 'صيدلية', '💊', 'Shopping'], [6, 'المطبخ', '🍳', 'FaultLocation'],
  [7, 'الصالة', '🛋️', 'FaultLocation'], [8, 'غرفة النوم', '🛏️', 'FaultLocation'],
  [9, 'الحمام', '🚿', 'FaultLocation'], [10, 'غرفة الغسيل', '🧺', 'FaultLocation'],
  [11, 'عيد ميلاد', '🎂', 'OccasionType'], [12, 'فاتورة', '💡', 'OccasionType'],
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
    role: 'مالك البيت', isOwner: true, joinedAt: t, updatedAt: t, deleted: false,
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
  token, uid: u.uid, email: u.email, displayName: u.displayName,
  householdId: u.householdId || null,
});

const normEmail = (e) => String(e || '').trim().toLowerCase();

/* ---------- المسارات ---------- */
async function route(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;

  if (p === '/health') return send(res, 200, { ok: true, at: now() });

  /* ===== حساب جديد ===== */
  if (p === '/signup' && method === 'POST') {
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
    save();
    return send(res, 200, publicUser(db.users[uid], signToken(uid)));
  }

  /* ===== تسجيل الدخول ===== */
  if (p === '/login' && method === 'POST') {
    const b = await readBody(req);
    const email = normEmail(b.email);
    const password = String(b.password || '');
    if (!email || !password) return fail(res, 400, 'invalid-email');
    if (tooMany(email)) return fail(res, 429, 'too-many-requests');
    const uid = db.emails[email];
    const u = uid ? db.users[uid] : null;
    if (!u) { noteAttempt(email, false); return fail(res, 404, 'user-not-found'); }
    if (!verifyPassword(password, u.pass)) { noteAttempt(email, false); return fail(res, 401, 'wrong-password'); }
    noteAttempt(email, true);
    return send(res, 200, publicUser(u, signToken(uid)));
  }

  /* ===== كل ما بعده يحتاج تسجيل دخول ===== */
  const user = authUser(req);
  if (!user) return fail(res, 401, 'no-user');

  if (p === '/me' && method === 'GET') {
    const hh = myHousehold(user);
    return send(res, 200, {
      ...publicUser(user, null),
      householdId: hh ? hh.id : null,
      household: hh ? { id: hh.id, name: hh.name, inviteCode: hh.inviteCode, createdAt: hh.createdAt } : null,
    });
  }

  if (p === '/profile' && method === 'POST') {
    const b = await readBody(req);
    if (b.displayName) { user.displayName = String(b.displayName).slice(0, 60); user.updatedAt = now(); save(); }
    return send(res, 200, { ok: true });
  }

  /* ===== إنشاء بيت ===== */
  if (p === '/household' && method === 'POST') {
    const b = await readBody(req);
    const hh = newHousehold(String(b.name || '').slice(0, 80), user, String(b.memberName || '').slice(0, 60));
    user.householdId = hh.id; user.updatedAt = now();
    if (b.memberName) user.displayName = String(b.memberName).slice(0, 60);
    save();
    return send(res, 200, { id: hh.id, name: hh.name, inviteCode: hh.inviteCode, createdAt: hh.createdAt });
  }

  /* ===== الانضمام بكود ===== */
  if (p === '/household/join' && method === 'POST') {
    const b = await readBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    const hid = db.codes[code];
    const hh = hid ? db.households[hid] : null;
    if (!hh) return fail(res, 404, 'bad-code');
    const t = now();
    const memberName = String(b.memberName || user.displayName || 'مستخدم').slice(0, 60);
    const existing = hh.members[user.uid];
    hh.members[user.uid] = {
      uid: user.uid, name: memberName, email: user.email || '',
      role: existing?.isOwner ? 'مالك البيت' : 'عضو', isOwner: !!existing?.isOwner,
      joinedAt: existing?.joinedAt || t, updatedAt: t, deleted: false,
    };
    hh.updatedAt = t;
    user.householdId = hh.id; user.displayName = memberName; user.updatedAt = t;
    save();
    return send(res, 200, { id: hh.id, name: hh.name, inviteCode: hh.inviteCode, createdAt: hh.createdAt });
  }

  const hh = myHousehold(user);
  if (!hh) return fail(res, 404, 'no-household');

  if (p === '/household' && method === 'GET') {
    return send(res, 200, { id: hh.id, name: hh.name, inviteCode: hh.inviteCode, createdAt: hh.createdAt });
  }

  if (p === '/household/rename' && method === 'POST') {
    const b = await readBody(req);
    if (b.name) { hh.name = String(b.name).slice(0, 80); hh.updatedAt = now(); save(); }
    return send(res, 200, { ok: true });
  }

  /* ===== المزامنة: كل ما تغيّر بعد since ===== */
  if (p === '/sync' && method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const full = since <= 0;
    const out = { now: now(), household: { id: hh.id, name: hh.name, inviteCode: hh.inviteCode }, full };
    out.cols = {};
    for (const c of COLS) {
      const bucket = hh.cols[c] || {};
      const list = [];
      for (const k of Object.keys(bucket)) {
        const d = bucket[k];
        if ((d.updatedAt || 0) > since) list.push(d);
      }
      out.cols[c] = list;
    }
    out.members = Object.values(hh.members).filter((m) => (m.updatedAt || 0) > since);
    return send(res, 200, out);
  }

  /* ===== الكتابة: دفعة عمليات ===== */
  if (p === '/write' && method === 'POST') {
    const b = await readBody(req);
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 500) : [];
    const t = now();
    let applied = 0;
    for (const op of ops) {
      const col = String(op.col || '');
      if (!COLS.includes(col)) continue;
      const id = String(op.id ?? '');
      if (!id) continue;
      const bucket = hh.cols[col] || (hh.cols[col] = {});
      const prev = bucket[id];
      if (op.op === 'delete') {
        const keepId = op.numericId ?? prev?.id ?? (Number(id) || id);
        bucket[id] = { ...(prev || {}), id: keepId, deleted: true, updatedAt: t };
      } else if (op.op === 'merge' && prev) {
        bucket[id] = { ...prev, ...(op.data || {}), id: prev.id, deleted: false, updatedAt: t };
      } else {
        const data = op.data || {};
        bucket[id] = {
          ...(prev || {}), ...data,
          id: data.id ?? prev?.id ?? (Number(id) || id),
          createdAt: data.createdAt || prev?.createdAt || t,
          deleted: false, updatedAt: t,
        };
      }
      applied++;
    }
    if (applied) { hh.updatedAt = t; save(); }
    return send(res, 200, { ok: true, applied, now: t });
  }

  /* ===== الأعضاء ===== */
  if (p === '/members' && method === 'GET') {
    return send(res, 200, { members: Object.values(hh.members).filter((m) => !m.deleted) });
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
    if (!me?.isOwner && target !== user.uid) return fail(res, 403, 'owner-only');
    const m = hh.members[target];
    if (m) { m.deleted = true; m.updatedAt = now(); hh.updatedAt = now(); }
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
    console.error('خطأ', e);
    if (!res.headersSent) fail(res, 500, String(e.message || 'server-error'));
  });
});

server.listen(PORT, () => console.log('خادم بيتنا يعمل على المنفذ', PORT, '— البيانات في', DATA_DIR));
