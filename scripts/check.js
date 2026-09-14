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
const linesOf = (text) => text.split(/\r?\n/);

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
for (const line of linesOf(coreBody)) {
  const m = line.match(/'\.\/([^']*)'/);
  if (m && m[1]) listed.push(m[1]);
}
const missing = listed.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) bad('ملفات في CORE غير موجودة: ' + missing.join(', '));
else ok(listed.length + ' ملفًا في CORE كلها موجودة');

/* كل وحدة js يجب أن تكون مخزّنة وإلا انكسر العمل بلا إنترنت */
const modules = fs.readdirSync(path.join(ROOT, 'js'))
  /* admin-app مستقل عن الـ PWA ولا يجب أن يدخل ذاكرة التطبيق الرئيسي */
  .filter((f) => f.endsWith('.js') && f !== 'admin-app.js').map((f) => 'js/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'js/screens'))
    .filter((f) => f.endsWith('.js')).map((f) => 'js/screens/' + f));
const uncached = modules.filter((m) => !listed.includes(m));
if (uncached.length) bad('وحدات غير مخزّنة في CORE: ' + uncached.join(', '));
else ok('كل وحدات js مخزّنة للعمل بلا إنترنت');

/* ---------- الترجمات ---------- */
console.log('اللغات:');
const lines = linesOf(read('js/i18n.js'));
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
for (const line of linesOf(dockerfile)) {
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

/* ---------- ثبات الواجهة ---------- */
console.log('ثبات الواجهة:');
const app = read('js/app.js');
const css = read('css/app.css');
const swBlock = app.slice(app.indexOf("if ('serviceWorker' in navigator)"), app.indexOf('const INSTALL_DISMISS_KEY'));
if (/addEventListener\(['"]controllerchange['"][\s\S]{0,1200}location\.reload\s*\(/.test(swBlock)) {
  bad('controllerchange يعيد تحميل الصفحة — سيظهر كوميض عند العودة من الخلفية');
} else ok('تحديث عامل الخدمة لا يعيد تحميل الصفحة النشطة');

if (/\.view\s*\{[^}]*animation\s*:/s.test(css)) {
  bad('كل إعادة رسم تشغّل حركة دخول على .view');
} else if (/\.view\.enter\s*\{[^}]*animation\s*:/s.test(css)) {
  ok('حركة الشاشة محصورة بالتنقّل الحقيقي');
} else bad('لم تُوجد حركة دخول مشروطة للشاشة');

if (/\.navitem\.active\s+\.ic\s*\{[^}]*transform\s*:/s.test(css)) {
  bad('الأيقونة النشطة تتحرك رأسيًا في الشريط السفلي');
} else ok('موضع أيقونات الشريط ثابت عند الضغط والتفعيل');

if (app.includes('class="nav-svg"') && css.includes('.nav-svg {')) {
  ok('جرس التذكيرات رمز ثابت الأبعاد لا يعتمد على خط الإيموجي');
} else bad('جرس التذكيرات لا يملك رسمًا ثابت الأبعاد');

if (/\.view\s*\{[^}]*overflow-x:\s*hidden/s.test(css) && /\.tabs\s*\{[^}]*max-width:\s*100%/s.test(css)) {
  ok('تبويبات التذكيرات لا توسّع الصفحة وتحرك الشريط السفلي');
} else bad('التمدد الأفقي لصفحة التذكيرات غير محصور');

/* ---------- إدارة قائمة الاحتياجات ---------- */
console.log('قائمة الاحتياجات:');
const store = read('js/store.js');
const cloud = read('js/cloud.js');
const server = read('server/server.js');
const pantry = read('js/screens/pantry.js');
for (const [name, source] of [['المخزن', store], ['المزامنة', cloud], ['الخادم', server]]) {
  if (source.includes('pantryCategories')) ok('أقسام الاحتياجات موجودة في ' + name);
  else bad('pantryCategories ناقصة من ' + name);
}
if (pantry.includes('data-edit=') && pantry.includes('updatePantryItem')) ok('تعديل اسم المنتج وقسمه موصول');
else bad('ميزة تعديل منتج الاحتياجات غير مكتملة');
if (pantry.includes('data-add-product') && pantry.includes('data-add-category')) ok('زرا إضافة المنتج والقسم ظاهران');
else bad('أزرار إضافة المنتجات والأقسام غير ظاهرة');
if (store.includes("push('save', 'pantryCategories'") && cloud.includes("'pantryCategories'")) ok('الأقسام الجديدة تتزامن بين الأجهزة');
else bad('الأقسام الجديدة لا تتزامن بين الأجهزة');

/* ---------- لوحة إدارة النظام ---------- */
console.log('لوحة الإدارة:');
const adminHtml = read('admin.html');
const adminJs = read('js/admin-app.js');
if (!app.includes("route('/admin'") && !read('js/screens/more.js').includes("'/admin'")) ok('لوحة الإدارة غير مدمجة في التطبيق الرئيسي');
else bad('لوحة الإدارة ما زالت مدمجة في التطبيق الرئيسي');
if (server.includes("p === '/admin/login'") && server.includes('authAdminPanel(req)')) ok('الدخول برمز مستقل ومحمي من الخادم');
else bad('دخول لوحة الإدارة المستقلة غير مكتمل');
if (adminHtml.includes('js/admin-app.js') && adminHtml.includes('css/admin.css')) ok('صفحة الإدارة المستقلة موصولة بملفاتها');
else bad('ملفات صفحة الإدارة المستقلة غير موصولة');
if (adminJs.includes("request('/admin/stats')") && adminJs.includes("request('/admin/backup'")) {
  ok('التحديث والنسخ الاحتياطي وفحص الخادم موصولة');
} else bad('إجراءات لوحة الإدارة غير مكتملة');
if (server.includes('signupsDaily') && server.includes('pushDevices') && server.includes('membersTotal')) {
  ok('مؤشرات النشاط والأجهزة والأعضاء متوفرة من الخادم');
} else bad('مؤشرات لوحة الإدارة ناقصة من الخادم');
if (!sw.includes('admin.html') && !sw.includes('admin-app.js') && !sw.includes('admin.css')) ok('لوحة الإدارة مستقلة عن ذاكرة التطبيق الرئيسي');
else bad('لوحة الإدارة دُمجت في Service Worker الخاص بالتطبيق');

console.log('');
console.log(failed ? (failed + ' فحصًا فشل') : 'كل الفحوص سليمة');
process.exit(failed ? 1 : 0);

