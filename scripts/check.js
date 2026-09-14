#!/usr/bin/env node
/* ============================================================
   فحص بنيوي سريع — يُشغَّل قبل النشر
   يمسك أخطاء صامتة لا يكشفها فحص البناء: معالج مفقود في
   الـ Service Worker، أو وحدة غير مخزَّنة، أو مفتاح ترجمة ناقص.
   الاستعمال: node scripts/check.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NL = String.fromCharCode(10);

let failed = 0;
const ok = (m) => console.log('  [ok] ' + m);
const bad = (m) => { failed++; console.error('  [!!] ' + m); };

/* ---------- Service Worker ---------- */
const sw = read('sw.js');
console.log('Service Worker:');
for (const ev of ['install', 'activate', 'fetch', 'message', 'push', 'notificationclick']) {
  const n = sw.split("addEventListener('" + ev + "'").length - 1;
  if (n === 1) ok('معالج ' + ev);
  else bad('معالج ' + ev + ' موجود ' + n + ' مرة — المتوقع مرة واحدة');
}

const version = (sw.match(/beitna-v[0-9.]+/) || [])[0];
if (version) ok('النسخة ' + version); else bad('لا توجد VERSION في الـ Service Worker');

/* كل ملف في CORE يجب أن يكون موجودًا فعلًا */
const coreStart = sw.indexOf('const CORE = [');
const coreBody = sw.slice(coreStart, sw.indexOf('];', coreStart));
const listed = [];
for (const line of coreBody.split(NL)) {
  const m = line.match(/'\.\/([^']*)'/);
  if (m && m[1]) listed.push(m[1]);
}
const missing = listed.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) bad('ملفات في CORE غير موجودة: ' + missing.join(', '));
else ok(listed.length + ' ملفًا في CORE كلها موجودة');

/* كل وحدة js يجب أن تكون مخزّنة وإلا انكسر العمل بلا إنترنت */
const modules = fs.readdirSync(path.join(ROOT, 'js'))
  .filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'js/screens'))
    .filter((f) => f.endsWith('.js')).map((f) => 'js/screens/' + f));
const uncached = modules.filter((m) => !listed.includes(m));
if (uncached.length) bad('وحدات غير مخزّنة في CORE: ' + uncached.join(', '));
else ok('كل وحدات js مخزّنة للعمل بلا إنترنت');

/* ---------- الترجمات ---------- */
console.log('اللغات:');
const lines = read('js/i18n.js').split(NL);
const tables = {};
let current = null;
for (const line of lines) {
  const open = line.match(/^  ([a-z]{2}): \{$/);
  if (open) { current = open[1]; tables[current] = []; continue; }
  if (current && line === '  },') { current = null; continue; }
  if (current) {
    const key = line.match(/^    ([A-Za-z_][A-Za-z0-9_]*):/);
    if (key) tables[current].push(key[1]);
  }
}
const codes = Object.keys(tables);
if (!codes.length) bad('لم يُقرأ أي جدول ترجمة');
else {
  const base = tables[codes[0]];
  ok(codes.length + ' لغات (' + codes.join(', ') + ')، ' + base.length + ' مفتاحًا');
  let mismatch = 0;
  for (const c of codes) {
    const miss = base.filter((k) => !tables[c].includes(k));
    const extra = tables[c].filter((k) => !base.includes(k));
    if (miss.length || extra.length) {
      mismatch++;
      bad(c + ': ناقص [' + miss.join(',') + '] زائد [' + extra.join(',') + ']');
    }
  }
  if (!mismatch) ok('تطابق المفاتيح تام');
}


/* ---------- حاوية الخادم: كل ما يُستدعى محليًا يجب أن يُنسخ ---------- */
console.log('حاوية الخادم:');
const dockerfile = read('server/Dockerfile');
const copied = [];
for (const line of dockerfile.split(NL)) {
  const m = line.match(/^COPY (.+) \.\/?$/);
  if (m) copied.push.apply(copied, m[1].trim().split(/ +/));
}
if (!copied.length) bad('لم يُقرأ أي سطر COPY من server/Dockerfile');
else {
  ok('COPY ينسخ: ' + copied.join(', '));
  const entry = read('server/server.js');
  const needed = (entry.match(/require\('\.\/[^']+'\)/g) || [])
    .map((s) => s.slice(11, -2))
    .map((d) => (d.slice(-3) === '.js' ? d : d + '.js'));
  if (!needed.length) ok('لا استدعاءات محلية في server.js');
  for (const file of needed) {
    if (copied.indexOf(file) >= 0 || copied.indexOf('.') >= 0) ok('مستدعى محليًا ومنسوخ: ' + file);
    else bad('server.js يستدعي ' + file + ' والـ Dockerfile لا ينسخه — الحاوية تموت عند الإقلاع');
  }
}
/* ---------- شاشات ميتة ----------
   شاشة ترسم عناصر قابلة للضغط (data-nav / data-act / data-go) ثم لا
   تسجّل mount لا يعمل فيها شيء إطلاقًا، ولا يظهر خطأ في أي مكان.
   حدث هذا في الرئيسية: 13 عنصرًا ميتًا — bindHome مُعرَّفة ولا تُستدعى.
   النطاق: من مطلع الشاشة إلى مطلع التصدير التالي. */
console.log('الشاشات:');
const fs2 = require('fs');
const path2 = require('path');
let screensChecked = 0;
for (const f of fs2.readdirSync('js/screens')) {
  if (!f.endsWith('.js')) continue;
  const src = read(path2.join('js/screens', f));
  const marks = [];
  const re = /export (?:function|const) ([A-Za-z]+)/g;
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index });
  marks.forEach((mk, i) => {
    if (!/Screen$/.test(mk.name)) return;
    const body = src.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : src.length);
    if (!/data-(nav|act|go|save|fab|seed|send|tick)=/.test(body)) return;
    screensChecked++;
    if (body.indexOf('mount(') >= 0 || body.indexOf('topActions(') >= 0) ok(mk.name + ' موصولة');
    else bad(mk.name + ' في ' + f + ' ترسم عناصر قابلة للضغط بلا mount — الشاشة ميتة');
  });
}
if (!screensChecked) bad('لم تُفحص أي شاشة — تغيّر شكل الملفات؟');

console.log('');
console.log(failed ? (failed + ' فحصًا فشل') : 'كل الفحوص سليمة');
process.exit(failed ? 1 : 0);
