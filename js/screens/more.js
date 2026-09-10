/* شاشة المزيد وما يتفرّع منها */

import { esc, fmtDate, relTime } from '../util.js';
import {
  getState, updateProfile, addMember, removeMember, addCategory, removeCategory,
  setNotification, setDarkMode, profileStats, archiveItems, signOut, resetAll,
  generateInviteCode, update, isCloud, CURRENCY,
} from '../store.js';
import { emptyState, toast, confirmDialog, openSheet, switchEl } from '../ui.js';
import { go } from '../router.js';
import { requestNotificationPermission, notificationState } from '../notify.js';
import { pendingWrites } from '../cloud.js';

/* ============================ المزيد ============================ */

/** شريط حالة المزامنة — يوضّح العمل بدون إنترنت وعدد التغييرات المنتظرة */
function syncBar() {
  if (!isCloud()) {
    return `
      <div class="install-bar mt" style="background:var(--surface-2)">
        <span style="font-size:20px">📱</span>
        <div class="grow">
          <div class="strong small">وضع محلي — هذا الجهاز فقط</div>
          <div class="tiny muted">سجّل خروجًا ثم ادخل بحساب لتتزامن بياناتك بين الأجهزة.</div>
        </div>
      </div>`;
  }
  let pending = 0;
  try { pending = pendingWrites(); } catch { pending = 0; }
  const offline = !navigator.onLine;
  const icon = offline ? '📴' : (pending ? '🔄' : '☁️');
  const title = offline
    ? 'بدون إنترنت — التطبيق يعمل عادي'
    : (pending ? 'جارٍ رفع تغييراتك...' : 'المزامنة مع بيتك مفعّلة');
  const note = offline
    ? (pending
        ? `${pending} تغييرًا محفوظًا على جهازك، سيُرفع تلقائيًا أول ما يعود الاتصال.`
        : 'كل بياناتك متاحة، وأي تعديل سيُرفع تلقائيًا عند عودة الاتصال.')
    : (pending
        ? `${pending} تغييرًا قيد الرفع الآن.`
        : 'كل شيء محفوظ ومتزامن مع بقية أفراد البيت.');
  return `
    <div class="install-bar mt" style="background:${offline ? 'var(--surface-2)' : 'var(--mint)'}">
      <span style="font-size:20px">${icon}</span>
      <div class="grow">
        <div class="strong small">${title}</div>
        <div class="tiny muted">${note}</div>
      </div>
    </div>`;
}

export function moreScreen() {
  const s = getState();
  const st = profileStats();

  return {
    title: 'المزيد',
    html: `
      <div class="card tap" data-nav="/profile">
        <div class="row" style="gap:14px">
          <div style="width:56px;height:56px;border-radius:50%;background:var(--emerald);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:800">
            ${esc((s.profile.name || 'ب').slice(0, 1))}
          </div>
          <div class="grow">
            <div style="font-size:17px;font-weight:800">${esc(s.profile.name || 'مستخدم')}</div>
            <div class="muted small">${esc(s.profile.role || 'عضو')} • ${esc(s.household.name || 'بيتي')}</div>
          </div>
          <span class="muted">‹</span>
        </div>
      </div>

      ${syncBar()}

      <div class="stats mt">
        <div class="stat"><div class="n">${st.shoppingAdded}</div><div class="l">مشتريات أضفتها</div></div>
        <div class="stat"><div class="n">${st.faultsReported}</div><div class="l">أعطال سجّلتها</div></div>
        <div class="stat"><div class="n">${st.occasionsTotal}</div><div class="l">مناسبات</div></div>
      </div>

      <div class="section">
        <div class="section-title">الحساب</div>
        <div class="list">
          ${listRow('👤', 'الملف الشخصي', 'المعلومات الشخصية', '/profile')}
          ${listRow('👨‍👩‍👧', 'أفراد البيت', `${s.members.length} أعضاء • كود الدعوة`, '/household')}
          ${listRow('🔔', 'الإشعارات', 'التنبيهات والتفضيلات', '/notifications')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">التفضيلات</div>
        <div class="list">
          ${listRow('🗂️', 'التصنيفات والأماكن', 'إدارة الأقسام والأنواع', '/categories')}
          ${listRow('📦', 'الأرشيف', 'مشتريات وأعطال ومناسبات منتهية', '/archive')}
          <div class="list-row" data-toggle="dark">
            <span class="ic">🌙</span>
            <span class="grow"><span class="t">الوضع الليلي</span><br>
              <span class="d">${s.settings.darkMode ? 'مفعّل — مظهر داكن' : 'غير مفعّل — مظهر فاتح'}</span></span>
            ${switchEl(s.settings.darkMode, 'dark')}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">أخرى</div>
        <div class="list">
          ${listRow('💬', 'الدعم والمساعدة', 'أسئلة شائعة وتواصل', '/support')}
          <button class="list-row" data-act="export">
            <span class="ic">⬇️</span>
            <span class="grow"><span class="t">تصدير نسخة احتياطية</span><br><span class="d">حفظ بياناتك كملف JSON</span></span>
            <span class="arrow">‹</span>
          </button>
          <button class="list-row" data-act="import">
            <span class="ic">⬆️</span>
            <span class="grow"><span class="t">استيراد نسخة</span><br><span class="d">استرجاع بياناتك من ملف</span></span>
            <span class="arrow">‹</span>
          </button>
        </div>
      </div>

      <div class="mt">
        <button class="btn danger-soft block" data-act="signout">تسجيل الخروج</button>
      </div>
      <p class="center tiny muted mt">بيتنا © ${new Date().getFullYear()} — صُمّم بحب لكل عائلة<br>إدارة المنزل بذكاء — نسخة الويب 1.6.1</p>
      <input type="file" id="importFile" accept="application/json" hidden>
    `,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const nav = e.target.closest('[data-nav]');
        if (nav) { go(nav.dataset.nav); return; }

        if (e.target.closest('[data-toggle="dark"]')) {
          setDarkMode(!getState().settings.darkMode);
          rerender();
          return;
        }

        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'signout') {
          const ok = await confirmDialog({
            title: 'تسجيل الخروج',
            message: 'هل تريد تسجيل الخروج؟ ستحتاج للدخول مرة أخرى للوصول للبيانات.',
            confirmText: 'خروج', danger: true,
          });
          if (ok) { signOut(); location.reload(); }
        }
        if (act === 'export') exportBackup();
        if (act === 'import') root.querySelector('#importFile').click();
      });

      root.querySelector('#importFile').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          const ok = await confirmDialog({
            title: 'استيراد نسخة', message: 'سيتم استبدال بياناتك الحالية بالنسخة المستوردة. متابعة؟',
            confirmText: 'استيراد', danger: true,
          });
          if (!ok) return;
          update((s) => { Object.assign(s, data); });
          toast('تم الاستيراد ✓');
          location.reload();
        } catch { toast('الملف غير صالح'); }
      });
    },
  };
}

const listRow = (icon, title, desc, to) => `
  <button class="list-row" data-nav="${esc(to)}">
    <span class="ic">${icon}</span>
    <span class="grow"><span class="t">${esc(title)}</span><br><span class="d">${esc(desc)}</span></span>
    <span class="arrow">‹</span>
  </button>`;

function exportBackup() {
  const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `beitna-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('تم تنزيل النسخة الاحتياطية ✓');
}

/* ============================ الملف الشخصي ============================ */
export function profileScreen() {
  const s = getState();
  const st = profileStats();
  return {
    title: 'الملف الشخصي',
    back: true,
    html: `
      <div class="card center">
        <div style="width:80px;height:80px;border-radius:50%;background:var(--emerald);color:#fff;display:grid;place-items:center;font-size:34px;font-weight:800;margin:0 auto 12px">
          ${esc((s.profile.name || 'ب').slice(0, 1))}
        </div>
        <div style="font-size:19px;font-weight:800">${esc(s.profile.name || 'مستخدم')}</div>
        <div class="muted small">${esc(s.profile.role)} • انضم في ${esc(fmtDate(s.profile.joinedAt))}</div>
      </div>

      <div class="section">
        <div class="section-title">المعلومات الشخصية</div>
        <div class="card">
          <div class="field"><label for="pname">الاسم</label>
            <input class="input" id="pname" value="${esc(s.profile.name)}"></div>
          <div class="field"><label for="prole">الدور</label>
            <input class="input" id="prole" value="${esc(s.profile.role)}" placeholder="ابن، بنت، شريك..."></div>
          <div class="field"><label for="pphone">رقم الجوال</label>
            <input class="input" id="pphone" type="tel" value="${esc(s.profile.phone)}" placeholder="غير مسجّل" style="direction:ltr;text-align:left"></div>
          <button class="btn block" data-save>حفظ التغييرات</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">إحصائياتي الفعلية</div>
        <div class="card">
          <div class="kv"><span class="k">مشتريات أضفتها</span><span class="v">${st.shoppingAdded}</span></div>
          <div class="kv"><span class="k">منها تم شراؤه</span><span class="v">${st.shoppingDone}</span></div>
          <div class="kv"><span class="k">أعطال سجّلتها</span><span class="v">${st.faultsReported}</span></div>
          <div class="kv"><span class="k">إنفاق هذا الشهر</span><span class="v">${st.monthlySpent.toFixed(2)} ${CURRENCY}</span></div>
          <div class="kv"><span class="k">إجمالي المشتريات</span><span class="v">${st.totalSpent.toFixed(2)} ${CURRENCY}</span></div>
          <div class="kv"><span class="k">تكاليف الأعطال</span><span class="v">${st.totalFaultCost.toFixed(2)} ${CURRENCY}</span></div>
        </div>
      </div>`,
    mount(root, rerender) {
      root.querySelector('[data-save]').onclick = () => {
        updateProfile({
          name: root.querySelector('#pname').value.trim() || 'مستخدم',
          role: root.querySelector('#prole').value.trim() || 'عضو',
          phone: root.querySelector('#pphone').value.trim(),
        });
        toast('تم الحفظ ✓');
        rerender();
      };
    },
  };
}

/* ============================ أفراد البيت ============================ */
export function householdScreen() {
  const s = getState();
  return {
    title: 'أفراد البيت',
    back: true,
    html: `
      <div class="card">
        <div class="tiny muted center" style="margin-bottom:8px">كود الدعوة</div>
        <div class="invite-code" id="code">${esc(s.household.inviteCode || '—')}</div>
        <p class="tiny muted center mt-s">شارك هذا الكود مع أفراد عائلتك للانضمام إلى البيت</p>
        <div class="row" style="gap:8px">
          <button class="btn soft grow" data-act="copy">📋 نسخ</button>
          <button class="btn ghost grow" data-act="share">📤 مشاركة</button>
          ${isCloud() ? '' : `<button class="icon-btn" data-act="regen" title="توليد كود جديد">🔄</button>`}
        </div>
      </div>

      <div class="section">
        <div class="section-title">الأعضاء (${s.members.length})</div>
        <div class="stack">
          ${s.members.map((m) => `
            <div class="item">
              <div class="avatar" style="background:var(--emerald);color:#fff;font-weight:800">${esc(m.name.slice(0, 1))}</div>
              <div class="grow col">
                <div class="title">${esc(m.name)} ${m.isOwner ? '<span class="badge">مالك</span>' : ''}</div>
                <div class="meta">
                  <span class="dot ${m.isOnline ? 'on' : ''}"></span>
                  <span>${esc(m.role)}</span>${m.phone ? ` • <span style="direction:ltr">${esc(m.phone)}</span>` : ''}
                </div>
              </div>
              ${m.isOwner ? '' : `<button class="icon-btn" data-remove="${m.id}" title="إزالة">✕</button>`}
            </div>`).join('')}
        </div>
        ${isCloud()
          ? `<div class="card mt small muted">لإضافة فرد جديد: أرسل له كود الدعوة أعلاه، ويدخله عند إنشاء حسابه — سينضم للبيت مباشرة وتتزامن بياناته لحظيًا.</div>`
          : `<button class="btn ghost block mt">＋ إضافة عضو جديد</button>`}
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'copy') {
          await navigator.clipboard.writeText(getState().household.inviteCode);
          toast('تم نسخ الكود ✓');
        }
        if (act === 'share') {
          const text = `انضم إلى بيتنا 🏡\nكود الدعوة: ${getState().household.inviteCode}\n${location.origin}${location.pathname}`;
          try { navigator.share ? await navigator.share({ text }) : await navigator.clipboard.writeText(text); }
          catch { /* أُلغيت */ }
        }
        if (act === 'regen') {
          const ok = await confirmDialog({ title: 'كود جديد', message: 'سيتم توليد كود دعوة جديد. الكود القديم لن يعمل.', confirmText: 'توليد' });
          if (ok) { update((s) => { s.household.inviteCode = generateInviteCode(); }); rerender(); toast('تم توليد كود جديد'); }
        }

        const rm = e.target.closest('[data-remove]');
        if (rm) {
          const ok = await confirmDialog({
            title: 'إزالة عضو', message: 'هل أنت متأكد من إزالة هذا العضو من البيت؟',
            confirmText: 'إزالة', danger: true,
          });
          if (ok) { removeMember(Number(rm.dataset.remove)); rerender(); toast('تم إزالة عضو'); }
          return;
        }

        if (e.target.closest('.btn.ghost.block')) {
          openSheet(`
            <h3>إضافة عضو جديد</h3>
            <div class="field"><label for="mn">اسم العضو</label><input class="input" id="mn" placeholder="سارة"></div>
            <div class="field"><label for="mr">الدور</label><input class="input" id="mr" placeholder="ابن، بنت، شريك..." value="عضو"></div>
            <div class="field"><label for="mp">رقم الجوال</label><input class="input" id="mp" type="tel" style="direction:ltr;text-align:left"></div>
            <button class="btn block" id="msave">إضافة</button>
          `, {
            onMount(sheet, close) {
              sheet.querySelector('#msave').onclick = () => {
                const n = sheet.querySelector('#mn').value.trim();
                if (!n) return toast('اكتب اسم العضو');
                addMember({ name: n, role: sheet.querySelector('#mr').value.trim() || 'عضو', phone: sheet.querySelector('#mp').value.trim() });
                close(); rerender(); toast(`تمت إضافة عضو: ${n}`);
              };
            },
          });
        }
      });
    },
  };
}

/* ============================ الإشعارات ============================ */
const NOTIF_ROWS = [
  ['shoppingReminders', '🛒', 'تذكيرات المشتريات', 'يوجد عناصر ضرورية لم تُشترَ بعد'],
  ['faultUpdates', '🔧', 'تحديثات الأعطال', 'إشعار عند تغيير حالة عطل'],
  ['occasionAlerts', '🎉', 'تنبيهات المناسبات', 'تذكير قبل المناسبة بوقت كافٍ'],
  ['partnerActivity', '👥', 'نشاط الشريك', 'نبهني عند أي إضافة من شريك البيت'],
  ['dailySummary', '📋', 'ملخص يومي', 'تقرير قصير كل صباح'],
  ['sound', '🔊', 'الصوت', 'تشغيل صوت مع الإشعارات'],
  ['vibration', '📳', 'الاهتزاز', 'اهتزاز خفيف عند التنبيه'],
  ['quietHours', '🌙', 'وضع الهدوء الليلي', 'كتم الإشعارات من 11 مساءً إلى 7 صباحًا'],
];

export function notificationsScreen() {
  const n = getState().notifications;
  const perm = notificationState();
  return {
    title: 'الإشعارات',
    back: true,
    html: `
      ${perm !== 'granted' ? `
        <div class="install-bar">
          <span style="font-size:22px">🔔</span>
          <div class="grow"><div class="strong small">تفعيل التذكيرات والتنبيهات</div>
            <div class="tiny muted">اسمح للمتصفح بإرسال الإشعارات لتصلك تذكيرات المناسبات.</div></div>
          <button class="btn sm" data-act="perm">تفعيل</button>
        </div>` : `
        <div class="install-bar"><span style="font-size:20px">✅</span>
          <div class="grow small strong">الإشعارات مفعّلة على هذا الجهاز</div></div>`}

      <div class="list">
        ${NOTIF_ROWS.map(([key, ic, t, d]) => `
          <div class="list-row" data-toggle="${key}">
            <span class="ic">${ic}</span>
            <span class="grow"><span class="t">${esc(t)}</span><br><span class="d">${esc(d)}</span></span>
            ${switchEl(n[key], key)}
          </div>`).join('')}
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="perm"]')) {
          const ok = await requestNotificationPermission();
          toast(ok ? 'تم تفعيل الإشعارات ✓' : 'لم يتم منح الإذن');
          rerender();
          return;
        }
        const row = e.target.closest('[data-toggle]');
        if (row) {
          const key = row.dataset.toggle;
          setNotification(key, !getState().notifications[key]);
          rerender();
        }
      });
    },
  };
}

/* ============================ التصنيفات ============================ */
const CAT_TABS = [
  { id: 'Shopping', label: 'تصنيف مشتريات' },
  { id: 'FaultLocation', label: 'مكان في البيت' },
  { id: 'OccasionType', label: 'نوع مناسبة' },
];
let catTab = 'Shopping';

export function categoriesScreen() {
  const cats = getState().categories.filter((c) => c.type === catTab);
  return {
    title: 'التصنيفات والأماكن',
    back: true,
    html: `
      <div class="tabs" style="margin-bottom:12px">
        ${CAT_TABS.map((t) => `<button class="tab ${t.id === catTab ? 'active' : ''}" data-cat="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <div class="stack">
        ${cats.length ? cats.map((c) => `
          <div class="item">
            <div class="avatar">${esc(c.icon)}</div>
            <div class="grow"><div class="title">${esc(c.name)}</div></div>
            <button class="icon-btn" data-del="${c.id}" title="حذف">🗑️</button>
          </div>`).join('') : emptyState('🗂️', 'لا توجد تصنيفات', 'أضف تصنيفًا جديدًا من الأسفل')}
      </div>
      <button class="btn block mt" data-add>＋ إضافة جديدة</button>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-cat]');
        if (t) { catTab = t.dataset.cat; rerender(); return; }

        const d = e.target.closest('[data-del]');
        if (d) {
          const ok = await confirmDialog({ title: 'تأكيد الحذف', message: 'هل أنت متأكد من حذف هذا العنصر؟', confirmText: 'حذف', danger: true });
          if (ok) { removeCategory(Number(d.dataset.del)); rerender(); toast('تم الحذف'); }
          return;
        }

        if (e.target.closest('[data-add]')) {
          openSheet(`
            <h3>إضافة جديدة</h3>
            <div class="field"><label for="cn">الاسم</label><input class="input" id="cn" placeholder="بقالة، حمام..."></div>
            <div class="field"><label for="ci">الأيقونة (Emoji)</label><input class="input" id="ci" value="📦" style="text-align:center;font-size:22px"></div>
            <button class="btn block" id="csave">إضافة</button>
          `, {
            onMount(sheet, close) {
              sheet.querySelector('#csave').onclick = () => {
                const n = sheet.querySelector('#cn').value.trim();
                if (!n) return toast('اكتب الاسم');
                addCategory({ name: n, icon: sheet.querySelector('#ci').value.trim() || '📦', type: catTab });
                close(); rerender(); toast('تمت الإضافة ✓');
              };
            },
          });
        }
      });
    },
  };
}

/* ============================ الأرشيف ============================ */
const ARCH_TABS = ['مشتريات', 'أعطال', 'مناسبات'];
let archTab = 'مشتريات';

export function archiveScreen() {
  const a = archiveItems();
  const list = archTab === 'مشتريات' ? a.shopping : archTab === 'أعطال' ? a.faults : a.occasions;

  return {
    title: 'الأرشيف',
    subtitle: 'مشتريات وأعطال ومناسبات منتهية',
    back: true,
    html: `
      <div class="tabs" style="margin-bottom:12px">
        ${ARCH_TABS.map((t) => {
          const n = t === 'مشتريات' ? a.shopping.length : t === 'أعطال' ? a.faults.length : a.occasions.length;
          return `<button class="tab ${t === archTab ? 'active' : ''}" data-arch="${esc(t)}">${esc(t)} (${n})</button>`;
        }).join('')}
      </div>
      <div class="stack">
        ${list.length ? list.map((x) => `
          <div class="item done">
            <div class="avatar">${archTab === 'مشتريات' ? '🛒' : archTab === 'أعطال' ? '🔧' : '🎉'}</div>
            <div class="grow col">
              <div class="title">${esc(x.name || x.title)}</div>
              <div class="meta">${esc(relTime(x.purchasedAt || x.fixedAt || x.doneAt || x.createdAt || x.dateMillis))}</div>
            </div>
          </div>`).join('')
        : emptyState('📦', 'الأرشيف فارغ', 'العناصر اللي تكمّلها أو تنتهي راح تظهر هنا')}
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-arch]');
        if (t) { archTab = t.dataset.arch; rerender(); }
      });
    },
  };
}

/* ============================ الدعم ============================ */
const FAQ = [
  ['كيف أدعو زوجتي للتطبيق؟', 'افتح "المزيد" > "أفراد البيت"، وانسخ كود الدعوة من البطاقة العلوية ثم أرسله لها.'],
  ['أين تُحفظ بياناتي؟', 'في نسخة الويب تُحفظ البيانات داخل متصفح جهازك، وتبقى موجودة حتى لو أغلقت التطبيق أو كنت بدون إنترنت.'],
  ['كيف أضيف التطبيق لشاشة الجوال؟', 'من قائمة المتصفح اختر "إضافة إلى الشاشة الرئيسية"، وسيعمل بيتنا كتطبيق مستقل بدون إنترنت.'],
  ['كيف أنقل بياناتي لجهاز آخر؟', 'من "المزيد" > "تصدير نسخة احتياطية"، ثم استوردها في الجهاز الآخر من "استيراد نسخة".'],
  ['كيف أحذف عنصرًا بالخطأ؟', 'ادخل على تفاصيل العنصر وستجد زر الحذف. لا يمكن استعادة المحذوفات حاليًا.'],
  ['هل يمكنني تخصيص التصنيفات؟', 'نعم، من "المزيد" > "التصنيفات والأماكن" يمكنك إضافة وحذف التصنيفات.'],
];

export function supportScreen() {
  return {
    title: 'الدعم والمساعدة',
    back: true,
    html: `
      <div class="card">
        <div class="strong">أهلاً بك في الدعم</div>
        <p class="muted small" style="margin:4px 0 0">نحن هنا لمساعدتك. تصفّح الأسئلة الشائعة أو تواصل معنا مباشرة.</p>
      </div>

      <div class="section">
        <div class="section-title">الأسئلة الشائعة</div>
        <div class="list">
          ${FAQ.map(([q, ans], i) => `
            <button class="list-row" data-faq="${i}">
              <span class="ic">💡</span>
              <span class="grow"><span class="t">${esc(q)}</span></span>
              <span class="arrow">‹</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">تواصل معنا</div>
        <div class="list">
          <button class="list-row" data-act="bug"><span class="ic">🐞</span>
            <span class="grow"><span class="t">الإبلاغ عن مشكلة</span></span><span class="arrow">‹</span></button>
          <button class="list-row" data-act="idea"><span class="ic">✨</span>
            <span class="grow"><span class="t">اقتراح ميزة جديدة</span></span><span class="arrow">‹</span></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">خطر — منطقة الحذف</div>
        <button class="btn danger-soft block" data-act="reset">🗑️ حذف كل البيانات وإعادة الضبط</button>
      </div>

      <p class="center tiny muted mt">إدارة المنزل بذكاء — الإصدار 1.6.1</p>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const f = e.target.closest('[data-faq]');
        if (f) {
          const [q, ans] = FAQ[Number(f.dataset.faq)];
          openSheet(`<h3>${esc(q)}</h3><p class="muted" style="font-size:14.5px">${esc(ans)}</p>
                     <button class="btn block" onclick="this.closest('.sheet-root').hidden=true;this.closest('.sheet-root').innerHTML='';document.body.style.overflow=''">حسنًا</button>`);
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'bug' || act === 'idea') {
          const subject = act === 'bug' ? 'بلاغ عن مشكلة في بيتنا' : 'اقتراح ميزة جديدة لبيتنا';
          location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
        }
        if (act === 'reset') {
          const ok = await confirmDialog({
            title: 'حذف كل البيانات',
            message: 'سيتم تسجيل خروجك ومسح كل البيانات المحفوظة على هذا الجهاز والبدء من جديد. لا يمكن التراجع.',
            confirmText: 'حذف الكل', danger: true,
          });
          if (ok) {
            resetAll();
            location.replace(location.origin + location.pathname + '?reset=all');
          }
        }
      });
    },
  };
}
