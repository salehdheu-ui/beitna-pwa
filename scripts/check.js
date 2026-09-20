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
const i18nText = read('js/i18n.js');
const expectedCodes = ['ar','en','hi','si','ta','am','tl','id','my','sw','ne'];
function localeTable(name) {
  const start = i18nText.indexOf(`const ${name} = {`);
  const end = i18nText.indexOf('\n};', start);
  const body = i18nText.slice(start, end);
  const out = {};
  for (const code of expectedCodes) {
    const multi = body.match(new RegExp(`^  ${code}: \\{([\\s\\S]*?)^  \\},`, 'm'));
    const single = body.match(new RegExp(`^  ${code}: \\{(.*)\\},?$`, 'm'));
    const localeBody = multi?.[1] ?? single?.[1] ?? '';
    out[code] = [...localeBody.matchAll(/(?:^|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
  }
  return out;
}
for (const name of ['STR', 'AUTH', 'SYSTEM']) {
  const tables = localeTable(name);
  const base = tables.ar;
  if (!base.length) { bad(`لم يُقرأ جدول ${name}`); continue; }
  let mismatch = 0;
  for (const code of expectedCodes) {
    const miss = base.filter((k) => !tables[code].includes(k));
    const extra = tables[code].filter((k) => !base.includes(k));
    if (miss.length || extra.length) {
      mismatch++;
      bad(`${name}.${code}: ناقص [${miss.join(',')}] زائد [${extra.join(',')}]`);
    }
  }
  if (!mismatch) ok(`${name}: ${expectedCodes.length} لغة، ${base.length} مفتاحًا متطابقًا`);
}

const authScreen = read('js/screens/auth.js');
const i18nSource = read('js/i18n.js');
const utilSource = read('js/util.js');
if (authScreen.includes("t('welcome_title')") && authScreen.includes("t('recover_account')")) ok('رحلة الدخول والانضمام تستخدم ترجمة اللغة المختارة');
else bad('شاشة الدخول لا تطبّق ترجمة النظام بعد اختيار اللغة');
if (i18nSource.includes("document.title = `${t('app_name')}") && i18nSource.includes('MAIN_PATTERNS')) {
  ok('العنوان والنصوص الديناميكية تتبع لغة النظام');
} else bad('ترجمة العنوان أو النصوص الديناميكية غير موصولة');
if (utilSource.includes("currentLang() === 'en'") && utilSource.includes('Intl.DateTimeFormat')) {
  ok('التاريخ والوقت والعدّ التنازلي تتبع اللغة');
} else bad('تنسيق التاريخ والوقت لا يتبع اللغة');
const helperSource = read('js/screens/helper.js');
const cloudSource = read('js/cloud.js');
const serverSource = read('server/server.js');
if (helperSource.includes("t('shopping_title')") && helperSource.includes("t('report_fault')"))
  ok('شاشة العاملة اليومية تستخدم قاموس اللغات');
else bad('شاشة العاملة تحتوي نصوصًا غير موصولة بالقاموس');
if (cloudSource.includes('localizedPush') || serverSource.includes('localizedPush'))
  ok('إشعارات العاملة السحابية تتبع لغة حسابها');
else bad('إشعارات العاملة السحابية لا تتبع اللغة');


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

/* الشاشة لا تتحرك أبدًا: لا عند الفتح ولا عند التنقّل.
   قياسًا قبل الإصلاح: كل تنقّل يقفز بالمحتوى من y=70 إلى y=76 بشفافية
   صفر ثم يزحف عائدًا خلال 220ms — وعند الفتح ينكشف السبلاش في وسط ذلك. */
if (/\.view[^{]*\{[^}]*animation\s*:/s.test(css)) {
  bad('على .view حركة — الشاشة ستتحرك عند الفتح وعند التنقّل');
} else ok('الشاشة تظهر في موضعها بلا حركة');

if (app.includes("classList.toggle('enter'")) {
  bad("app.js ما زال يضيف صنف enter — أعِد إزالته");
} else ok('لا توصيل لحركة دخول في الكود');

/* والشريط المؤجَّل يظهر بالشفافية فقط، بلا انزلاق */
if (/\.install-root \.install-bar\s*\{[^}]*animation:\s*fadeIn/s.test(css)) {
  ok('شريط التثبيت يظهر بالشفافية فقط');
} else bad('شريط التثبيت ينزلق عند ظهوره');

if (app.includes('INSTALL_DELAY_MS')) ok('شريط التثبيت مؤجَّل بعد استقرار الواجهة');
else bad('شريط التثبيت يظهر أثناء الإقلاع فيضيف حركة ثانية');

if (/^\.navitem\s*\{[^}]*height:\s*100%/ms.test(css)) {
  bad('height:100% على .navitem العامة — تتكدّس أيقونات الشريط الجانبي خارج الشاشة');
} else ok('ملء الارتفاع محصور بالشريط السفلي');

/* الصفحة تنزل بالإصبع والعجلة، لا بالكود وحده.
   ‎overflow-x: hidden‎ على ‎body‎ يجعله حاوية تمرير، و‎overscroll-behavior‎
   عليه يمنعه من تسليم التمرير إلى الصفحة — فتُقفل كل الشاشات.
   ‎window.scrollTo‎ يظل يعمل، فلا يكشفه إلا فحص بإيماءة حقيقية. */
const cssBare = css.replace(/[/][*][^]*?[*][/]/g, '');
const overscrollOnBody = cssBare.split('}').find((r) => {
  const parts = r.split('{');
  if (parts.length < 2 || !/overscroll-behavior/.test(parts[1])) return false;
  return parts[0].split(',').some((sel) => /(^|[\s>+~])body$/.test(sel.trim()));
});
if (overscrollOnBody) {
  bad('overscroll-behavior على body — لا تنزل أي صفحة بالإصبع ولا بالعجلة');
} else ok('لا شيء يمنع تمرير الصفحة بالإصبع');

const overscrollOnHtml = cssBare.split('}').some((r) => {
  const parts = r.split('{');
  if (parts.length < 2 || !/overscroll-behavior-y: *none/.test(parts[1])) return false;
  return parts[0].split(',').some((sel) => sel.trim() === 'html');
});
if (overscrollOnHtml) ok('منع السحب المطاطي باقٍ على html');
else bad('السحب المطاطي / سحب-التحديث غير ممنوع');

/* قرص المفتاح لا يخرج من إطاره.
   ‎translateX‎ فيزيائي لا يعرف يمنى من يسرى، فلا بدّ من إشارتين:
   موجبة للاتجاه اليسرى وسالبة لليمنى. والمسافة نفسها محسوبة من
   القياسات: عرض الإطار − عرض القرص − حاشيتين. أي تغيير في المقاسات
   بلا تغيير المسافة يُخرج القرص نصفه خارج المفتاح (وقع ذلك فعلاً). */
const num = (re) => { const m = cssBare.match(re); return m ? parseFloat(m[1]) : NaN; };
const knobBlock = (cssBare.match(/\.switch::after\s*\{([^}]*)\}/) || [, ''])[1];
const trackW = num(/\.switch\s*\{[^}]*width:\s*([\d.]+)px/);
const knobW = parseFloat((knobBlock.match(/width:\s*([\d.]+)px/) || [, NaN])[1]);
const inset = parseFloat((knobBlock.match(/inset-inline-start:\s*([\d.]+)px/) || [, NaN])[1]);
const travelLtr = num(/\.switch\.on::after\s*\{[^}]*translateX\((-?[\d.]+)px\)/);
const travelRtl = num(/rtl"\]\s\.switch\.on::after\s*\{[^}]*translateX\((-?[\d.]+)px\)/);
const want = trackW - knobW - inset * 2;
if (!isFinite(inset)) {
  bad('قرص المفتاح غير مثبّت عند بداية السطر — ينزلق خارج إطاره في العربية');
} else if (travelLtr === want && travelRtl === -want) {
  ok('قرص المفتاح ينزلق ' + want + 'px ويبقى داخل إطاره في الاتجاهين');
} else {
  bad('مسافة انزلاق المفتاح ' + travelLtr + '/' + travelRtl + ' والصحيح ' + want + '/' + (-want));
}

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
const moreScreen = read('js/screens/more.js');
if (!app.includes("route('/admin'") &&
    !moreScreen.includes("'/admin'") &&
    !moreScreen.includes('adminSection') &&
    !moreScreen.includes('openStatsSheet') &&
    !moreScreen.includes('amAdmin()')) ok('لوحة الإدارة غير مدمجة في التطبيق الرئيسي');
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
if (sw.includes("ADMIN_PATHS = new Set(['/admin.html', '/css/admin.css', '/js/admin-app.js'])") &&
    sw.includes('ADMIN_PATHS.has(url.pathname)') &&
    !listed.includes('admin.html') &&
    !listed.includes('css/admin.css') &&
    !listed.includes('js/admin-app.js')) ok('لوحة الإدارة مستثناة صراحةً من اعتراض التطبيق وذاكرته');
else bad('لوحة الإدارة دُمجت في Service Worker أو لم تُستثنَ من اعتراضه');
if (app.includes('/^#\\/admin(?:\\/|$)/') && app.includes("'#/home'")) ok('المسار الإداري القديم يعود إلى الرئيسية');
else bad('المسار الإداري القديم قد يُبقي المستخدم في صفحة مفقودة');

/* ---------- لا سرّ مكتوب في مستودع عام ---------- */
console.log('سرّ لوحة الإدارة:');
const srv = read('server/server.js');
const line = (srv.match(/ADMIN_PANEL_CODE_HASH[^;]*;/s) || [''])[0];
if (/['"][0-9a-f]{32,}['"]/.test(line)) {
  bad('بصمة رمز الإدارة مكتوبة في الكود — تُكسَر خارج الخادم بلا حدّ محاولات');
} else ok('لا بصمة افتراضية في الكود');
if (srv.includes('ADMIN_PANEL_READY')) ok('اللوحة تُغلق إن لم يُضبط المتغيّر (فشل مغلق)');
else bad('لا فشل مغلق: اللوحة تعمل بلا سرّ مضبوط');

/* ---------- حدود المستند ---------- */
console.log('حدود ما يُكتب في البيت:');
const srv2 = read('server/server.js');
if (srv2.includes('function capDoc(')) ok('المستندات محدودة الحجم قبل الحفظ');
else bad('لا حدّ لحجم المستند — نصّ ضخم من فرد واحد يُثقل البيت على الجميع');
if (/op\.data = capDoc\(op\.data\)/.test(srv2)) ok('الحدّ مطبَّق على كل عملية كتابة');
else bad('capDoc معرّفة ولا تُستدعى في مسار الكتابة');
if (srv2.includes('IMAGE_FIELDS')) ok('صور الأعطال مستثناة فلا تُقطع');
else bad('حقول الصور ستُقطع بحدّ النصّ العادي');
if (/'bad-json'\);/.test(srv2) && srv2.includes("m === 'bad-json'")) ok('الطلب التالف يردّ 400 لا 500');
else bad('جسم الطلب التالف يردّ خطأ خادم وهميًا');

/* ---------- اسم مُلغى ---------- */
console.log('الاسم المُلغى:');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const shipped = ['js', 'css', 'server']
  .flatMap(walk)
  .concat(['index.html', 'admin.html', 'manifest.json', 'README.md'])
  .filter((f) => /[.](js|css|html|json|md)$/.test(f));
const retired = 'عيد ميلاد';
const hits = [];
for (const f of shipped) {
  linesOf(read(f)).forEach((ln, i) => {
    if (ln.includes(retired)) hits.push(f.split(path.sep).join('/') + ':' + (i + 1));
  });
}
const allowed = 'js/store.js';
const stray = hits.filter((h) => !h.startsWith(allowed + ':'));
if (stray.length) {
  bad('الاسم المُلغى ما زال في: ' + stray.join('، '));
} else if (hits.length === 1) {
  ok('الاسم المُلغى لا يظهر إلا في سطر تنظيفه');
} else if (!hits.length) {
  bad('سطر تنظيف الاسم المُلغى اختفى — يعود التصنيف مع كل مزامنة');
} else {
  bad('الاسم المُلغى مكتوب ' + hits.length + ' مرات في store.js — المتوقع مرة');
}
const storeSrc = read('js/store.js');
if (/if \(collection === 'categories' \|\| collection === 'occasions'\) dropRetiredType\(\);/.test(storeSrc)) {
  ok('التنظيف يعمل بعد كل دفعة تصل من الخادم');
} else bad('التنظيف لا يعمل بعد المزامنة — يعود التصنيف من الخادم');

/* ---------- حقن الشيفرة ---------- */
console.log('حقن الشيفرة:');
const screenFiles = fs.readdirSync(path.join(ROOT, 'js', 'screens'))
  .filter((f) => /[.]js$/.test(f)).map((f) => 'js/screens/' + f).concat(['js/ui.js', 'js/app.js']);

/* الأيقونة يكتبها فرد من البيت وتصل إلى أجهزة البقية. كانت تُحقن في
   الصفحة بلا تهريب، فوسمٌ واحد في خانة الأيقونة يشتغل عند الجميع
   ويقرأ رمز الجلسة من التخزين. */
const rawIcon = [];
for (const f of screenFiles) {
  linesOf(read(f)).forEach((ln, i) => {
    const hits = ln.match(/\$\{[^{}]*\}/g) || [];
    for (const h of hits) {
      const inner = h.slice(2, -1).trim();
      /* شرائح الاختيار تُهرّب عنوانها داخل chipSelect نفسها */
      if (ln.includes('chipSelect(')) continue;
      if (!/(catIcon|locIcon|\bcat\.icon\b|\bc\.icon\b)/.test(inner)) continue;
      if (/\besc\s*\(/.test(inner)) continue;
      rawIcon.push(f + ':' + (i + 1));
    }
  });
}
if (rawIcon.length) bad('أيقونة غير مهرَّبة في: ' + rawIcon.join('، '));
else ok('أيقونات التصنيفات مهرَّبة في كل موضع');

const inlineHandler = [];
for (const f of screenFiles) {
  linesOf(read(f)).forEach((ln, i) => {
    if (/\son(click|error|load|change|input|submit)\s*=\s*["']/.test(ln)) inlineHandler.push(f + ':' + (i + 1));
  });
}
if (inlineHandler.length) bad('معالج مضمَّن داخل HTML — يمنعه CSP فيتعطّل الزر: ' + inlineHandler.join('، '));
else ok('لا معالج مضمَّن داخل HTML');

for (const page of ['index.html', 'admin.html']) {
  const html = read(page);
  const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/);
  if (!m) { bad(page + ': لا سياسة محتوى'); continue; }
  const csp = m[1];
  const script = (csp.match(/script-src ([^;]*)/) || [, ''])[1];
  if (!/'self'/.test(script) || /unsafe-inline|unsafe-eval|[*]/.test(script)) {
    bad(page + ': script-src متساهل — ' + script.trim());
  } else ok(page + ': السكربت من ملفاتنا وحدها');
  if (/object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp)) ok(page + ': base-uri و object-src محكمان');
  else bad(page + ': ينقصه base-uri أو object-src');
}

if (/'invalid-credentials'/.test(read('server/server.js'))
    && !/fail\(res, 404, 'user-not-found'\)/.test(read('server/server.js'))) {
  ok('الدخول لا يفرّق بين بريد مجهول وكلمة خاطئة');
} else bad('ردّ الدخول يكشف من يملك حسابًا');

if (/rateLimited\('login:' \+ clientIp\(req\)/.test(read('server/server.js'))) {
  ok('الدخول محدود حسب المصدر أيضًا');
} else bad('كلمة واحدة تُجرَّب على كل البُرد من مصدر واحد بلا حدّ');

console.log('');
console.log(failed ? (failed + ' فحصًا فشل') : 'كل الفحوص سليمة');
process.exit(failed ? 1 : 0);

