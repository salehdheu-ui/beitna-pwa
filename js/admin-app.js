const API = location.origin + '/api';
const TOKEN_KEY = 'beitna:standalone-admin';
const $ = (s) => document.querySelector(s);

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let toastTimer = 0;

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
  const activity = stats.users ? Math.round(stats.activeUsers30d / stats.users * 100) : 0;
  const collections = COLLECTIONS.map(([key,icon,label]) => [icon,label,Number(stats.items?.[key] || 0)]);
  const maxItems = Math.max(1, ...collections.map((x) => x[2]));
  $('#dashboardRoot').innerHTML = `
    <section class="page-head"><div><h1>نظرة عامة على النظام</h1><p>بيانات مجمّعة لا تحتوي أسماء المستخدمين أو محتوى بيوتهم.</p></div>
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
    </section>`;
}

function showLogin(message = '') {
  token = ''; sessionStorage.removeItem(TOKEN_KEY);
  $('#dashboardView').hidden = true; $('#loginView').hidden = false;
  $('#adminCode').value = '';
  const err = $('#loginError'); err.textContent = message; err.hidden = !message;
  $('#adminCode').focus();
}

async function loadDashboard() {
  $('#dashboardRoot').innerHTML = '<div class="loading"><div><div class="spinner"></div>جارٍ تحميل بيانات النظام...</div></div>';
  try { render(await request('/admin/stats')); }
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

$('#dashboardRoot').addEventListener('click', async (event) => {
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

