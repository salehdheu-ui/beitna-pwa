/* لوحة إدارة النظام — لا تُعرض إلا لحساب أقرّه الخادم كمشرف. */

import { esc, relTime } from '../util.js';
import { emptyState, toast } from '../ui.js';
import { isCloud } from '../store.js';
import {
  amAdmin, loadStats, runBackup, checkServer,
  apiBase, currentEmail, arabicError,
} from '../cloud.js';

const nf = (n, digits = 0) => Number(n || 0).toLocaleString('ar-OM', {
  maximumFractionDigits: digits,
});

const age = (seconds) => {
  const s = Number(seconds || 0);
  if (s < 60) return `${nf(s)} ثانية`;
  if (s < 3600) return `${nf(s / 60)} دقيقة`;
  if (s < 86400) return `${nf(s / 3600, 1)} ساعة`;
  return `${nf(s / 86400, 1)} يوم`;
};

const bytes = (n) => {
  const value = Number(n || 0);
  if (value < 1024) return `${nf(value)} بايت`;
  if (value < 1048576) return `${nf(value / 1024, 1)} ك.ب`;
  return `${nf(value / 1048576, 1)} م.ب`;
};

const COLLECTIONS = [
  ['shopping', '🛒', 'المشتريات'],
  ['faults', '🔧', 'الأعطال'],
  ['occasions', '🔔', 'التذكيرات'],
  ['pantry', '📋', 'منتجات الاحتياجات'],
  ['pantryCategories', '🏷️', 'أقسام الاحتياجات'],
  ['favoriteLists', '⭐', 'القوائم المحفوظة'],
  ['categories', '🗂️', 'التصنيفات'],
];

function kpi(icon, label, value, note = '') {
  return `<div class="admin-kpi">
    <span class="admin-kpi-icon">${icon}</span>
    <div class="admin-kpi-value">${esc(value)}</div>
    <div class="admin-kpi-label">${esc(label)}</div>
    ${note ? `<div class="admin-kpi-note">${esc(note)}</div>` : ''}
  </div>`;
}

function trendHtml(days = []) {
  const max = Math.max(1, ...days.map((d) => Number(d.count || 0)));
  const dayName = new Intl.DateTimeFormat('ar-OM', { weekday: 'short', timeZone: 'UTC' });
  return `<div class="admin-trend" aria-label="تسجيلات آخر سبعة أيام">
    ${days.map((d) => {
      const height = Math.max(8, Math.round((Number(d.count || 0) / max) * 100));
      const label = dayName.format(new Date(`${d.date}T12:00:00Z`));
      return `<div class="admin-trend-day">
        <span class="admin-trend-count">${nf(d.count)}</span>
        <span class="admin-trend-bar"><i style="height:${height}%"></i></span>
        <span class="admin-trend-label">${esc(label)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function dashboardHtml(st) {
  const activity = st.users ? Math.round((Number(st.activeUsers30d || 0) / st.users) * 100) : 0;
  const entries = COLLECTIONS.map(([key, icon, label]) => [icon, label, Number(st.items?.[key] || 0)]);
  const maxItems = Math.max(1, ...entries.map((x) => x[2]));

  return `
    <section class="admin-hero">
      <div>
        <div class="admin-eyebrow">إدارة بيتنا</div>
        <h2>نظرة عامة على النظام</h2>
        <p>مؤشرات مجمّعة فقط، بلا أسماء أو بريد أو محتوى خاص بأي بيت.</p>
      </div>
      <span class="admin-live"><i></i> النظام يعمل</span>
    </section>

    <div class="admin-actions">
      <button class="btn soft" data-admin-refresh>↻ تحديث البيانات</button>
      <button class="btn" data-admin-backup>🗄️ نسخة احتياطية الآن</button>
    </div>

    <div class="admin-kpis">
      ${kpi('👥', 'إجمالي المستخدمين', nf(st.users), `+${nf(st.usersNew7d)} خلال ٧ أيام`)}
      ${kpi('⚡', 'نشطون آخر ٣٠ يومًا', nf(st.activeUsers30d), `${nf(activity)}٪ من المستخدمين`)}
      ${kpi('🏡', 'البيوت', nf(st.households), `${nf(st.householdsShared)} بيوت مشتركة`)}
      ${kpi('📦', 'إجمالي العناصر', nf(st.itemsTotal), 'في جميع البيوت')}
    </div>

    <div class="admin-layout">
      <section class="card admin-panel">
        <div class="admin-panel-head">
          <div><div class="strong">المستخدمون والنشاط</div><div class="tiny muted">آخر تحديث الآن</div></div>
          <span class="badge">٧ أيام</span>
        </div>
        ${trendHtml(st.signupsDaily || [])}
        <div class="admin-mini-grid">
          <div><b>${nf(st.activeUsers24h)}</b><span>نشط خلال ٢٤ ساعة</span></div>
          <div><b>${nf(st.usersNew30d)}</b><span>جديد خلال ٣٠ يومًا</span></div>
          <div><b>${nf(st.pushDevices)}</b><span>أجهزة إشعارات</span></div>
          <div><b>${nf(st.usersWithoutHousehold)}</b><span>بلا بيت حاليًا</span></div>
        </div>
      </section>

      <section class="card admin-panel">
        <div class="admin-panel-head">
          <div><div class="strong">استخدام مزايا التطبيق</div><div class="tiny muted">العناصر المحفوظة في النظام</div></div>
        </div>
        <div class="admin-usage">
          ${entries.map(([icon, label, value]) => `
            <div class="admin-usage-row">
              <span>${icon}</span><span class="grow">${esc(label)}</span><b>${nf(value)}</b>
              <span class="admin-usage-bar"><i style="width:${Math.round((value / maxItems) * 100)}%"></i></span>
            </div>`).join('')}
        </div>
      </section>

      <section class="card admin-panel">
        <div class="admin-panel-head">
          <div><div class="strong">البيوت والأعضاء</div><div class="tiny muted">صورة عامة للمجتمع</div></div>
        </div>
        <div class="admin-facts">
          <div><span>إجمالي العضويات</span><b>${nf(st.membersTotal)}</b></div>
          <div><span>متوسط الأفراد في البيت</span><b>${nf(st.avgMembers, 2)}</b></div>
          <div><span>بيوت بفرد واحد</span><b>${nf(st.householdsSolo)}</b></div>
          <div><span>بيوت مشتركة</span><b>${nf(st.householdsShared)}</b></div>
        </div>
      </section>

      <section class="card admin-panel">
        <div class="admin-panel-head">
          <div><div class="strong">الخادم والنسخ الاحتياطية</div><div class="tiny muted">${esc(apiBase())}</div></div>
          <span class="admin-version">v${esc(st.version || '—')}</span>
        </div>
        <div class="admin-facts">
          <div><span>مدة عمل الخادم</span><b>${esc(age(st.uptimeSec))}</b></div>
          <div><span>حجم قاعدة البيانات</span><b>${esc(bytes(st.dbBytes))}</b></div>
          <div><span>عدد النسخ الاحتياطية</span><b>${nf(st.backups)}</b></div>
          <div><span>آخر نسخة احتياطية</span><b>${st.lastBackupAt ? esc(relTime(st.lastBackupAt)) : '—'}</b></div>
        </div>
        <button class="btn ghost block mt" data-admin-health>🔌 فحص اتصال الخادم</button>
        <div class="tiny muted mt-s" data-admin-health-state>حساب المشرف: <span dir="ltr">${esc(currentEmail() || '—')}</span></div>
      </section>
    </div>`;
}

function deniedHtml(message) {
  return `${emptyState('🛡️', 'هذه الصفحة للمشرف فقط', message)}
    <div class="card tiny muted center">يعتمد الدخول على قائمة المشرفين في إعدادات خادم بيتنا، وليس على دورك داخل البيت.</div>`;
}

export function adminScreen() {
  return {
    title: 'لوحة الإدارة',
    back: true,
    html: '<div class="card center admin-loading"><div class="spinner"></div><div class="muted mt-s">جارٍ التحقق من صلاحية المشرف...</div></div>',
    mount(root) {
      let loading = false;

      const load = async () => {
        if (loading) return;
        loading = true;
        root.setAttribute('aria-busy', 'true');
        try {
          if (!isCloud()) {
            root.innerHTML = deniedHtml('سجّل الدخول بحساب سحابي مضاف إلى قائمة المشرفين.');
            return;
          }
          if (!(await amAdmin())) {
            root.innerHTML = deniedHtml('حسابك الحالي لا يملك صلاحية إدارة النظام.');
            return;
          }
          const stats = await loadStats();
          root.innerHTML = dashboardHtml(stats);
        } catch (e) {
          root.innerHTML = `${emptyState('⚠️', 'تعذّر تحميل لوحة الإدارة', arabicError(e))}
            <button class="btn block" data-admin-refresh>إعادة المحاولة</button>`;
        } finally {
          loading = false;
          root.removeAttribute('aria-busy');
        }
      };

      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-admin-refresh]')) { await load(); return; }

        const backup = e.target.closest('[data-admin-backup]');
        if (backup) {
          backup.disabled = true;
          const old = backup.textContent;
          backup.textContent = 'جارٍ إنشاء النسخة...';
          try {
            const r = await runBackup();
            toast(`تم حفظ النسخة ${r.file} ✓`, 4000);
            await load();
          } catch (ex) {
            toast(arabicError(ex), 4000);
            backup.disabled = false;
            backup.textContent = old;
          }
          return;
        }

        const health = e.target.closest('[data-admin-health]');
        if (health) {
          const state = root.querySelector('[data-admin-health-state]');
          health.disabled = true;
          if (state) state.textContent = 'جارٍ فحص الاتصال...';
          try {
            const r = await checkServer({ rediscover: true });
            if (state) {
              state.textContent = r.ok ? 'الخادم متصل ويستجيب بصورة سليمة ✓' : 'الخادم لا يستجيب حاليًا';
              state.style.color = r.ok ? 'var(--emerald)' : 'var(--danger)';
            }
          } catch {
            if (state) { state.textContent = 'تعذّر الوصول إلى الخادم'; state.style.color = 'var(--danger)'; }
          }
          health.disabled = false;
        }
      });

      load();
    },
  };
}

