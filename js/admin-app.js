const API = location.origin + '/api';
const TOKEN_KEY = 'beitna:standalone-admin';
const $ = (s) => document.querySelector(s);

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let toastTimer = 0;
let selectedAccount = null;
let accountAction = 'reset';
let resetLinkExpiresAt = 0;

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;',
}[c]));
const nf = (n, digits = 0) => Number(n || 0).toLocaleString('ar-OM', { maximumFractionDigits: digits });
const bytes = (n) => Number(n || 0) < 1048576 ? `${nf(Number(n || 0) / 1024, 1)} ك.ب` : `${nf(Number(n) / 1048576, 1)} م.ب`;
const age = (s) => s < 3600 ? `${nf(s / 60)} دقيقة` : s < 86400 ? `${nf(s / 3600, 1)} ساعة` : `${nf(s / 86400, 1)} يوم`;

function toast(message) {
  const el = $('#toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function request(path, options = {}) {
  const headers = { 'content-type':'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...options, headers, cache:'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'network'); err.status = res.status; err.code = data.error; throw err;
  }
  return data;
}

function messageOf(error) {
  if (error?.code === 'admin-not-configured') {
    return 'اللوحة مغلقة: لم يُضبط ADMIN_PANEL_CODE_HASH على الخادم بعد';
  }
  if (error?.code === 'wrong-admin-code') return 'رمز لوحة الإدارة غير صحيح';
  if (error?.code === 'account-not-found') return 'لا يوجد حساب بهذا البريد؛ تحقق من كتابته كاملًا';
  if (error?.code === 'invalid-email') return 'أدخل بريدًا إلكترونيًا صحيحًا';
  if (error?.code === 'mail-not-configured') return 'إرسال البريد غير مفعّل؛ اختر عرض رابط الاستعادة';
  if (error?.code === 'mail-send-failed') return 'تعذّر إرسال البريد؛ لم تُلغَ وصلة الاستعادة السابقة';
  if (error?.code === 'too-many-requests') return 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة';
  if (error?.code === 'admin-session-required' || error?.status === 401) return 'انتهت جلسة الإدارة — أدخل الرمز من جديد';
  if (error?.code === 'backup-failed') return 'تعذّر إنشاء النسخة الاحتياطية';
  return 'تعذّر الاتصال بالخادم';
}

const COLLECTIONS = [
  ['shopping','🛒','المشتريات'], ['faults','🔧','الأعطال'], ['occasions','🔔','التذكيرات'],
  ['pantry','📋','منتجات الاحتياجات'], ['pantryCategories','🏷️','أقسام الاحتياجات'],
  ['favoriteLists','⭐','القوائم المحفوظة'], ['categories','🗂️','التصنيفات'],
];

function kpi(icon, label, value, note) {
  return `<article class="kpi"><span class="kpi-icon">${icon}</span><strong>${esc(value)}</strong><b>${esc(label)}</b><small>${esc(note)}</small></article>`;
}

function trend(days = []) {
  const max = Math.max(1, ...days.map((d) => Number(d.count || 0)));
  const fmt = new Intl.DateTimeFormat('ar-OM', { weekday:'short', timeZone:'UTC' });
  return `<div class="trend">${days.map((d) => `<div class="trend-day"><small>${nf(d.count)}</small><span class="bar"><i style="height:${Math.max(7,Math.round(d.count/max*100))}%"></i></span><small>${esc(fmt.format(new Date(d.date+'T12:00:00Z')))}</small></div>`).join('')}</div>`;
}

function render(stats) {
  selectedAccount = null;
  const activity = stats.users ? Math.round(stats.activeUsers30d / stats.users * 100) : 0;
  const collections = COLLECTIONS.map(([key,icon,label]) => [icon,label,Number(stats.items?.[key] || 0)]);
  const maxItems = Math.max(1, ...collections.map((x) => x[2]));
  $('#dashboardRoot').innerHTML = `
    <section class="page-head"><div><h1>نظرة عامة على النظام</h1><p>مؤشرات عامة وأدوات استرداد الحسابات، دون الاطلاع على محتوى البيوت.</p></div>
      <div class="actions"><button class="secondary" data-refresh>↻ تحديث</button><button class="primary" data-backup>🗄️ نسخة احتياطية</button></div></section>
    <section class="kpis">
      ${kpi('👥','إجمالي المستخدمين',nf(stats.users),`+${nf(stats.usersNew7d)} خلال ٧ أيام`)}
      ${kpi('⚡','نشطون خلال ٣٠ يومًا',nf(stats.activeUsers30d),`${nf(activity)}٪ من المستخدمين`)}
      ${kpi('🏡','إجمالي البيوت',nf(stats.households),`${nf(stats.householdsShared)} بيوت مشتركة`)}
      ${kpi('📦','إجمالي العناصر',nf(stats.itemsTotal),'في جميع البيوت')}
    </section>
    <section class="grid">
      <article class="panel"><div class="panel-head"><div><h2>التسجيل والنشاط</h2><small>التسجيلات خلال آخر سبعة أيام</small></div><span class="chip">٧ أيام</span></div>
        ${trend(stats.signupsDaily || [])}
        <div class="mini-grid"><div><b>${nf(stats.activeUsers24h)}</b><span>نشط خلال ٢٤ ساعة</span></div><div><b>${nf(stats.usersNew30d)}</b><span>جديد خلال ٣٠ يومًا</span></div><div><b>${nf(stats.pushDevices)}</b><span>أجهزة إشعارات</span></div><div><b>${nf(stats.usersWithoutHousehold)}</b><span>بلا بيت</span></div></div>
      </article>
      <article class="panel"><div class="panel-head"><div><h2>استخدام مزايا التطبيق</h2><small>العناصر المحفوظة في النظام</small></div></div>
        <div class="usage">${collections.map(([icon,label,value]) => `<div class="usage-row"><span>${icon}</span><span>${esc(label)}</span><b>${nf(value)}</b><span class="usage-line"><i style="width:${Math.round(value/maxItems*100)}%"></i></span></div>`).join('')}</div>
      </article>
      <article class="panel"><div class="panel-head"><div><h2>البيوت والأعضاء</h2><small>مؤشرات عامة</small></div></div>
        <div class="facts"><div class="fact"><span>إجمالي العضويات</span><b>${nf(stats.membersTotal)}</b></div><div class="fact"><span>متوسط الأفراد في البيت</span><b>${nf(stats.avgMembers,2)}</b></div><div class="fact"><span>بيوت بفرد واحد</span><b>${nf(stats.householdsSolo)}</b></div><div class="fact"><span>بيوت مشتركة</span><b>${nf(stats.householdsShared)}</b></div></div>
      </article>
      <article class="panel"><div class="panel-head"><div><h2>الخادم والنسخ الاحتياطية</h2><small>${esc(API)}</small></div><span class="chip">v${esc(stats.version || '—')}</span></div>
        <div class="facts"><div class="fact"><span>مدة عمل الخادم</span><b>${age(stats.uptimeSec)}</b></div><div class="fact"><span>حجم قاعدة البيانات</span><b>${bytes(stats.dbBytes)}</b></div><div class="fact"><span>عدد النسخ الاحتياطية</span><b>${nf(stats.backups)}</b></div><div class="fact"><span>آخر نسخة</span><b>${stats.lastBackupAt ? new Date(stats.lastBackupAt).toLocaleString('ar-OM') : '—'}</b></div></div>
        <button class="secondary" style="width:100%;margin-top:12px" data-health>🔌 فحص الخادم</button>
      </article>
    </section>
    <section class="management-grid">
      <article class="panel"><div class="panel-head"><div><h2>إدارة الحسابات والاسترداد</h2><small>بحث دقيق بالبريد، دون الاطلاع على محتوى البيت</small></div></div>
        <form id="accountSearchForm" class="account-search"><div><label for="accountEmail">بريد صاحب الحساب</label><input id="accountEmail" type="email" inputmode="email" autocomplete="off" placeholder="name@example.com" required></div><button class="secondary" type="submit">بحث</button></form>
        <div id="accountResult" class="account-result" aria-live="polite"><p class="muted">يمكنك إنشاء رابط مؤقت ليختار صاحب الحساب كلمة مرور جديدة، أو إنهاء جلساته عند الاشتباه بوصول غير مصرح.</p></div>
      </article>
      <article class="panel"><div class="panel-head"><div><h2>آخر إجراءات الإدارة</h2><small>سجل مختصر بلا كلمات مرور أو روابط استعادة</small></div></div><div id="adminActivity" class="audit-list"><p class="muted">جارٍ تحميل السجل...</p></div></article>
    </section>`;
}

function renderAccount(account) {
  selectedAccount = account;
  const methods = [account.hasPassword ? 'كلمة مرور' : null, ...account.providers.map((p) => p === 'google' ? 'Google' : 'Apple')].filter(Boolean);
  $('#accountResult').innerHTML = `<div class="account-summary"><h3>${esc(account.displayName || 'حساب بلا اسم')}</h3><div class="account-email">${esc(account.email)}</div>
    <div class="account-meta">${methods.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}<span class="chip">${account.hasHousehold ? 'مرتبط ببيت' : 'بلا بيت'}</span></div>
    <p class="muted">تاريخ التسجيل: ${account.createdAt ? esc(new Date(account.createdAt).toLocaleDateString('ar-OM')) : '—'}${account.resetPendingUntil ? '<br>يوجد رابط استعادة لم تنتهِ صلاحيته؛ إصدار رابط جديد يلغي السابق.' : ''}</p>
    <div class="account-buttons"><button class="primary" data-account-action="reset">رابط إعادة تعيين كلمة المرور</button><button class="secondary danger-button" data-account-action="revoke">إنهاء الجلسات</button></div></div>`;
}

async function loadActivity() {
  const root = $('#adminActivity');
  if (!root) return;
  try {
    const data = await request('/admin/activity');
    root.innerHTML = data.actions.length ? data.actions.map((entry) => `<div class="audit-entry"><b>${entry.action === 'sessions-revoked' ? 'إنهاء جلسات الحساب' : entry.delivery === 'email' ? 'إرسال رابط استعادة بالبريد' : 'إنشاء رابط استعادة يدوي'}</b><small><bdi>${esc(entry.target)}</bdi> · ${esc(new Date(entry.at).toLocaleString('ar-OM'))}</small></div>`).join('') : '<p class="muted">لا توجد إجراءات مسجلة بعد.</p>';
  } catch { root.innerHTML = '<p class="muted">تعذّر تحميل سجل الإجراءات.</p>'; }
}

function openAccountAction(action) {
  if (!selectedAccount) return;
  accountAction = action;
  const reset = action === 'reset';
  $('#actionTitle').textContent = reset ? 'إعادة تعيين كلمة المرور' : 'إنهاء جلسات الحساب';
  $('#actionDescription').textContent = reset
    ? `الحساب: ${selectedAccount.email}. سيختار صاحب الحساب كلمته الجديدة عبر رابط صالح لمدة ١٥ دقيقة ولمرة واحدة. كلمة المرور الحالية والجلسات تبقى كما هي حتى استخدام الرابط.`
    : `الحساب: ${selectedAccount.email}. سيتم تسجيل خروجه من جميع الأجهزة وإلغاء روابط الاستعادة الحالية، دون حذف حسابه أو بيانات بيته.`;
  $('#accountActionForm').hidden = false; $('#actionResult').hidden = true; $('#actionError').hidden = true;
  $('#actionAdminCode').value = ''; $('#manualResetLink').value = '';
  $('#deliveryField').hidden = !reset || !selectedAccount.emailDelivery;
  $('#actionDelivery').value = selectedAccount.emailDelivery ? 'email' : 'manual';
  $('#actionSubmit').textContent = reset ? 'إنشاء رابط الاستعادة' : 'تأكيد إنهاء الجلسات';
  $('#actionSubmit').disabled = false;
  $('#accountDialog').showModal(); $('#actionAdminCode').focus();
}
function showLogin(message = '') {
  token = ''; sessionStorage.removeItem(TOKEN_KEY);
  selectedAccount = null;
  if ($('#accountDialog').open) $('#accountDialog').close();
  $('#dashboardView').hidden = true; $('#loginView').hidden = false;
  $('#adminCode').value = '';
  const err = $('#loginError'); err.textContent = message; err.hidden = !message;
  $('#adminCode').focus();
}

async function loadDashboard() {
  $('#dashboardRoot').innerHTML = '<div class="loading"><div><div class="spinner"></div>جارٍ تحميل بيانات النظام...</div></div>';
  try { render(await request('/admin/stats')); await loadActivity(); }
  catch (error) { showLogin(messageOf(error)); }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const err = $('#loginError'); err.hidden = true; button.disabled = true; button.textContent = 'جارٍ التحقق...';
  try {
    const result = await request('/admin/login', { method:'POST', body:JSON.stringify({ code:$('#adminCode').value }) });
    token = result.token; sessionStorage.setItem(TOKEN_KEY, token);
    $('#loginView').hidden = true; $('#dashboardView').hidden = false;
    await loadDashboard();
  } catch (error) { err.textContent = messageOf(error); err.hidden = false; }
  finally { button.disabled = false; button.textContent = 'دخول آمن'; }
});

$('#toggleCode').addEventListener('click', () => {
  const input = $('#adminCode'); input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggleCode').textContent = input.type === 'password' ? '👁️' : '🙈'; input.focus();
});
$('#logoutBtn').addEventListener('click', () => showLogin());

$('#dashboardRoot').addEventListener('submit', async (event) => {
  if (event.target.id !== 'accountSearchForm') return;
  event.preventDefault();
  const button = event.target.querySelector('button');
  const email = $('#accountEmail').value.trim();
  selectedAccount = null; button.disabled = true;
  $('#accountResult').textContent = 'جارٍ البحث...';
  try { renderAccount(await request('/admin/account/lookup', { method:'POST', body:JSON.stringify({ email }) })); }
  catch (error) {
    $('#accountResult').textContent = messageOf(error);
    if (error.code === 'admin-session-required') showLogin(messageOf(error));
  } finally { button.disabled = false; }
});

$('#accountActionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedAccount) return;
  const button = $('#actionSubmit'); button.disabled = true; $('#actionError').hidden = true;
  const adminCode = $('#actionAdminCode').value;
  $('#actionAdminCode').value = '';
  try {
    const result = await request(`/admin/account/${accountAction}`, { method:'POST', body:JSON.stringify({
      email:selectedAccount.email, adminCode,
      delivery:selectedAccount.emailDelivery ? $('#actionDelivery').value : 'manual',
    }) });
    $('#accountActionForm').hidden = true; $('#actionResult').hidden = false;
    $('#manualLinkBox').hidden = !result.link;
    $('#manualResetLink').value = result.link || '';
    resetLinkExpiresAt = result.expiresAt || 0;
    $('#actionResultText').textContent = accountAction === 'revoke'
      ? 'تم إنهاء جلسات الحساب وإلغاء روابط الاستعادة الحالية. بيانات البيت لم تتغير.'
      : result.delivery === 'email' ? 'أُرسل رابط الاستعادة إلى بريد صاحب الحساب.'
        : 'تم إنشاء الرابط. سلّمه لصاحب الحساب بعد التحقق من هويته. عند استخدامه تُلغى جميع الجلسات القديمة.';
    renderAccount({ ...selectedAccount, resetPendingUntil: accountAction === 'reset' ? result.expiresAt : null });
    await loadActivity();
  } catch (error) {
    $('#actionError').textContent = messageOf(error); $('#actionError').hidden = false;
    if (error.code === 'admin-session-required') showLogin(messageOf(error));
  } finally { button.disabled = false; }
});

for (const id of ['closeAction','doneAction']) $('#' + id).addEventListener('click', () => $('#accountDialog').close());
$('#accountDialog').addEventListener('close', () => {
  $('#actionAdminCode').value = ''; $('#manualResetLink').value = ''; resetLinkExpiresAt = 0;
});
$('#copyResetLink').addEventListener('click', async () => {
  if (!$('#manualResetLink').value || Date.now() >= resetLinkExpiresAt) return toast('انتهت صلاحية الرابط؛ أنشئ رابطًا جديدًا');
  try { await navigator.clipboard.writeText($('#manualResetLink').value); toast('نُسخ الرابط — أرسله لصاحب الحساب فقط'); }
  catch { $('#manualResetLink').focus(); $('#manualResetLink').select(); toast('حدد الرابط وانسخه يدويًا'); }
});

$('#dashboardRoot').addEventListener('click', async (event) => {
  const accountButton = event.target.closest('[data-account-action]');
  if (accountButton) { openAccountAction(accountButton.dataset.accountAction); return; }
  if (event.target.closest('[data-refresh]')) { await loadDashboard(); return; }
  const backup = event.target.closest('[data-backup]');
  if (backup) {
    backup.disabled = true; const old = backup.textContent; backup.textContent = 'جارٍ الحفظ...';
    try { const r = await request('/admin/backup', { method:'POST', body:'{}' }); toast(`تم حفظ ${r.file} ✓`); await loadDashboard(); }
    catch (error) { toast(messageOf(error)); backup.disabled = false; backup.textContent = old; }
    return;
  }
  const health = event.target.closest('[data-health]');
  if (health) {
    health.disabled = true;
    try { const h = await request('/health'); toast(h.ok ? `الخادم يعمل — الإصدار ${h.version || '—'} ✓` : 'الخادم لا يستجيب'); }
    catch { toast('تعذّر الوصول إلى الخادم'); }
    health.disabled = false;
  }
});

if (token) { $('#loginView').hidden = true; $('#dashboardView').hidden = false; loadDashboard(); }

