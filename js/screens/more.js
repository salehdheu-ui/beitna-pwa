/* شاشة المزيد وما يتفرّع منها */

import { esc, fmtDate, relTime } from '../util.js';
import {
  getState, updateProfile, addMember, removeMember, addCategory, removeCategory,
  setNotification, setDarkMode, profileStats, archiveItems, signOut, resetAll,
  uploadLocalData, persistNow,
  generateInviteCode, update, isCloud, CURRENCY,
} from '../store.js';
import { emptyState, toast, confirmDialog, openSheet, switchEl, iosInstallSheet } from '../ui.js';
import { go } from '../router.js';
import { requestNotificationPermission, notificationStatus, testNotification } from '../notify.js';
import { pushSupported, pushState, enablePush, disablePush, sendTestPush } from '../push.js';
import {
  pendingWrites, apiBase, checkServer, currentEmail,
  deleteAccount, loadStats, amAdmin, arabicError,
  changePassword, newRecoveryCode, listBackups, runBackup,
  listHouseholds, switchHousehold, getHelperCode, newHelperCode,
  setMemberRole, currentPerm, isOwner as amOwner, joinHousehold,
} from '../cloud.js';

/* ============================ المزيد ============================ */

/** شريط حالة المزامنة — يوضّح العمل بدون إنترنت وعدد التغييرات المنتظرة */
function syncBar() {
  if (!isCloud()) {
    const st = getState();
    const n = st.shopping.length + st.faults.length + st.occasions.length;
    return `
      <div class="install-bar mt" style="background:var(--surface-2)">
        <span style="font-size:20px">📱</span>
        <div class="grow">
          <div class="strong small">وضع محلي — هذا الجهاز فقط</div>
          <div class="tiny muted">اربطه بحساب لتتزامن بياناتك مع بقية الأجهزة.</div>
        </div>
        <button class="btn sm" data-act="link">🔗 ربط</button>
      </div>
      ${n ? `<p class="tiny muted mt-s">${n} عنصرًا على هذا الجهاز سيُرفع كما هو عند الربط.</p>` : ''}`;
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
        <div class="stat"><div class="n">${st.occasionsTotal}</div><div class="l">تذكيرات</div></div>
      </div>

      <div class="section">
        <div class="section-title">الحساب</div>
        <div class="list">
          ${listRow('👤', 'الملف الشخصي', 'المعلومات الشخصية', '/profile')}
          ${listRow('👨‍👩‍👧', 'أفراد البيت', `${s.members.length} أعضاء • كود الدعوة`, '/household')}
          ${isCloud() ? listRow('🏘️', 'بيوتي', 'التبديل بين بيتك وبيت أهلك', '/houses') : ''}
        ${listRow('🔔', 'الإشعارات', 'التنبيهات والتفضيلات', '/notifications')}
        </div>
      </div>

      ${s.profile.isOwner ? `
      <div class="section">
        <div class="section-title">إدارة</div>
        <div class="list">
          ${listRow('🎛️', 'لوحة التحكم', 'أسماء الأقسام وأيقوناتها وصلاحيات كل فرد', '/control')}
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-title">التفضيلات</div>
        <div class="list">
          ${listRow('🗂️', 'التصنيفات والأماكن', 'إدارة الأقسام والأنواع', '/categories')}
          ${listRow('📦', 'الأرشيف', 'مشتريات وأعطال وتذكيرات منتهية', '/archive')}
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
        if (e.target.closest('[data-act="link"]')) { linkDeviceToAccount(); return; }
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

      ${amOwner() && isCloud() ? `
      <div class="card mt" id="helperCard">
        <div class="strong small">👩‍🍳 دعوة العاملة المنزلية</div>
        <p class="tiny muted" style="margin:4px 0 10px">
          كود منفصل يفتح لها واجهة محدودة بلغتها: المشتريات والإبلاغ عن الأعطال فقط —
          بلا تذكيرات ولا أسعار ولا بيانات الأفراد.
        </p>
        <div class="invite-code" id="hcode">—</div>
        <div class="row mt-s" style="gap:8px">
          <button class="btn soft grow" data-act="hcopy">📋 نسخ</button>
          <button class="btn ghost grow" data-act="hnew">🔄 كود جديد</button>
        </div>
      </div>` : ''}

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
      const hbox = root.querySelector('#hcode');
      if (hbox) {
        getHelperCode()
          .then((r) => { hbox.textContent = r.helperCode || 'لم يُنشأ بعد'; })
          .catch(() => { hbox.textContent = '—'; });
      }

      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;

        if (act === 'hnew') {
          const ok = await confirmDialog({
            title: 'كود جديد للعاملة',
            message: 'سيتوقف الكود القديم عن العمل. من انضمّت به سابقًا تبقى في البيت.',
            confirmText: 'توليد',
          });
          if (!ok) return;
          try { const r = await newHelperCode(); hbox.textContent = r.helperCode; toast('تم توليد كود جديد ✓'); }
          catch (ex) { toast(arabicError(ex), 3500); }
          return;
        }
        if (act === 'hcopy') {
          const code = hbox?.textContent?.trim();
          if (!code || code === '—' || code === 'لم يُنشأ بعد') return toast('ولّد كودًا أولًا');
          await navigator.clipboard.writeText(code);
          toast('تم نسخ كود العاملة ✓');
          return;
        }

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
  ['occasionAlerts', '🔔', 'تنبيهات التذكيرات', 'ينبّهك قبل الموعد بوقت كافٍ'],
  ['partnerActivity', '👥', 'نشاط الشريك', 'نبهني عند أي إضافة من شريك البيت'],
  ['dailySummary', '📋', 'ملخص يومي', 'تقرير قصير كل صباح'],
  ['sound', '🔊', 'الصوت', 'تشغيل صوت مع الإشعارات'],
  ['vibration', '📳', 'الاهتزاز', 'اهتزاز خفيف عند التنبيه'],
  ['quietHours', '🌙', 'وضع الهدوء الليلي', 'كتم الإشعارات من 11 مساءً إلى 7 صباحًا'],
];

/** لافتة حالة الإشعارات — رسالة مفهومة لكل حالة بدل «لم يتم منح الإذن» */
function notifBanner(status) {
  if (status === 'granted') {
    return `
      <div class="install-bar">
        <span style="font-size:20px">✅</span>
        <div class="grow small strong">الإشعارات مفعّلة على هذا الجهاز</div>
        <button class="btn sm ghost" data-act="test">تجربة</button>
      </div>`;
  }
  if (status === 'ios-needs-install') {
    return `
      <div class="install-bar">
        <span style="font-size:22px">📲</span>
        <div class="grow">
          <div class="strong small">ثبّت بيتنا أولًا على الـ iPhone</div>
          <div class="tiny muted">إشعارات iPhone تعمل فقط بعد «إضافة إلى الشاشة الرئيسية».</div>
        </div>
        <button class="btn sm" data-act="ios">الطريقة</button>
      </div>`;
  }
  if (status === 'denied') {
    return `
      <div class="install-bar">
        <span style="font-size:22px">🚫</span>
        <div class="grow">
          <div class="strong small">الإشعارات محظورة من إعدادات المتصفح</div>
          <div class="tiny muted">افتح إعدادات هذا الموقع في متصفحك، فعّل «الإشعارات»، ثم ارجع لهذه الشاشة.</div>
        </div>
      </div>`;
  }
  if (status === 'unsupported') {
    return `
      <div class="install-bar">
        <span style="font-size:22px">ℹ️</span>
        <div class="grow">
          <div class="strong small">هذا المتصفح لا يدعم الإشعارات</div>
          <div class="tiny muted">استخدم Chrome على أندرويد، أو Safari على iPhone بعد تثبيت التطبيق.</div>
        </div>
      </div>`;
  }
  /* default — لم يُطلب الإذن بعد */
  return `
    <div class="install-bar">
      <span style="font-size:22px">🔔</span>
      <div class="grow">
        <div class="strong small">تفعيل التذكيرات والتنبيهات</div>
        <div class="tiny muted">اسمح للمتصفح بإرسال الإشعارات لتصلك تذكيراتك في وقتها.</div>
      </div>
      <button class="btn sm" data-act="perm">تفعيل</button>
    </div>`;
}

export function notificationsScreen() {
  const n = getState().notifications;
  const status = notificationStatus();
  return {
    title: 'الإشعارات',
    back: true,
    html: `
      ${notifBanner(status)}

      <div class="list">
        ${NOTIF_ROWS.map(([key, ic, t, d]) => `
          <div class="list-row" data-toggle="${key}">
            <span class="ic">${ic}</span>
            <span class="grow"><span class="t">${esc(t)}</span><br><span class="d">${esc(d)}</span></span>
            ${switchEl(n[key], key)}
          </div>`).join('')}
      </div>

      ${status === 'granted' && isCloud() && pushSupported() ? `
        <div class="section">
          <div class="section-title">حتى والتطبيق مغلق</div>
          <div class="list">
            <div class="list-row" data-push>
              <span class="ic">📡</span>
              <span class="grow"><span class="t">إشعارات فورية من الخادم</span><br>
                <span class="d">تصلك إضافات أفراد البيت والتطبيق مغلق تمامًا</span></span>
              <span id="pushSw"><span class="switch" role="switch" aria-checked="false"></span></span>
            </div>
          </div>
          <button class="btn ghost block mt-s" data-act="pushtest">📨 إشعار تجريبي من الخادم</button>
        </div>` : ''}

      <p class="tiny muted mt">
        التذكيرات (المواعيد والملخص اليومي) تُحسب على هذا الجهاز، فتصل ما دام
        التطبيق مفتوحًا أو يعمل في الخلفية. أمّا إضافات أفراد البيت فتصل من الخادم
        متى فعّلت الخيار أعلاه.
      </p>`,
    mount(root, rerender) {
      const pushRow = root.querySelector('[data-push]');
      const paintPush = (state) => {
        const box = root.querySelector('#pushSw');
        if (box) box.innerHTML = switchEl(state === 'on', 'push');
      };
      if (pushRow) pushState().then(paintPush).catch(() => paintPush('off'));

      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="ios"]')) { iosInstallSheet(); return; }

        if (e.target.closest('[data-push]')) {
          const now = await pushState();
          paintPush('...');
          try {
            if (now === 'on') { await disablePush(); toast('أُوقفت الإشعارات الخلفية'); }
            else { await enablePush(); toast('فُعّلت الإشعارات الخلفية ✓'); }
          } catch (ex) { toast(arabicError(ex), 3500); }
          paintPush(await pushState());
          return;
        }

        if (e.target.closest('[data-act="pushtest"]')) {
          try {
            const r = await sendTestPush();
            toast(r.sent ? `أُرسل إلى ${r.sent} جهاز 📨` : 'لم يصل أي جهاز — فعّل الخيار أولًا', 3500);
          } catch (ex) { toast(arabicError(ex), 3500); }
          return;
        }

        if (e.target.closest('[data-act="test"]')) {
          const sent = await testNotification();
          toast(sent ? 'أُرسل إشعار تجريبي 🔔' : 'تعذّر إرسال الإشعار التجريبي');
          return;
        }

        if (e.target.closest('[data-act="perm"]')) {
          /* الطلب يجب أن يبدأ داخل نقرة المستخدم — شرط Safari على iPhone */
          const ok = await requestNotificationPermission();
          if (ok) {
            await testNotification();
            toast('تم تفعيل الإشعارات ✓');
          } else {
            toast(notificationStatus() === 'denied'
              ? 'المتصفح يحظر الإشعارات — فعّلها من إعدادات الموقع'
              : 'لم يتم منح الإذن');
          }
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

/**
 * يربط جهازًا يعمل بلا حساب بحساب سحابي دون فقدان ما عليه.
 * كان التطبيق ينصح بتسجيل الخروج، و signOut() يستدعي blankState()
 * فيمحو كل ما أدخله المستخدم — فخّ فقدان بيانات صامت.
 */
async function linkDeviceToAccount() {
  const st = getState();
  const n = st.shopping.length + st.faults.length + st.occasions.length;
  const ok = await confirmDialog({
    title: 'ربط الجهاز بحساب',
    message: n
      ? `سيُرفع ${n} عنصرًا من هذا الجهاز إلى البيت الذي تدخل إليه، وتبقى نسخته هنا. `
        + 'ستُنقل إلى شاشة الدخول الآن.'
      : 'ستُنقل إلى شاشة الدخول لربط هذا الجهاز بحساب.',
    confirmText: 'متابعة',
  });
  if (!ok) return;
  /* العلامة تُقرأ بعد الدخول فتُرفع بيانات الجهاز تلقائيًا */
  try { localStorage.setItem('beitna:pending-upload', '1'); } catch { /* تجاهل */ }
  signOut({ keepData: true });      // الهوية فقط — البيانات تبقى
  persistNow();                     // الحفظ مؤجَّل، وإعادة التحميل تليه فورًا
  location.replace(location.origin + location.pathname);
}

/* ============================ بيوتي ============================ */
const PERM_BADGE = { owner: 'مالك', member: 'عضو', helper: 'عاملة' };

export function housesScreen() {
  return {
    title: 'بيوتي',
    back: true,
    html: `
      <div id="hhList"><div class="card small muted center">جارٍ التحميل...</div></div>
      <div class="section">
        <button class="btn ghost block" data-act="join">🔑 الانضمام إلى بيت بكود دعوة</button>
      </div>
      <p class="tiny muted mt">
        البيت النشط هو الذي تراه في كل الشاشات. التبديل لا يؤثّر على بيانات البيت الآخر.
      </p>`,
    mount(root, rerender) {
      const box = root.querySelector('#hhList');

      const draw = (list) => {
        const active = list.find((h) => h.active);
        box.innerHTML = `
          <div class="section">
            <div class="section-title">البيوت التي تنتمي إليها (${list.length})</div>
            <div class="stack">
              ${list.map((h) => `
                <button class="item" data-hh="${esc(h.id)}" ${h.active ? 'disabled' : ''}
                        style="${h.active ? 'border-color:var(--emerald)' : ''};text-align:inherit;width:100%">
                  <div class="avatar" style="background:${h.active ? 'var(--emerald)' : 'var(--surface-2)'};
                       color:${h.active ? '#fff' : 'var(--text)'};font-weight:800">🏡</div>
                  <div class="grow col">
                    <div class="title">${esc(h.name)}
                      <span class="badge">${esc(PERM_BADGE[h.perm] || h.role)}</span></div>
                    <div class="meta">${h.members} من الأفراد${h.active ? ' • البيت النشط' : ''}</div>
                  </div>
                  ${h.active ? '<span class="badge">✓</span>' : '<span class="arrow">‹</span>'}
                </button>`).join('')}
            </div>
          </div>`;
        if (active) box.dataset.active = active.id;
      };

      listHouseholds()
        .then(draw)
        .catch((e) => { box.innerHTML = `<div class="err">${esc(arabicError(e))}</div>`; });

      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="join"]')) { go('/join-house'); return; }

        const btn = e.target.closest('[data-hh]');
        if (!btn || btn.disabled) return;
        const id = btn.dataset.hh;
        btn.disabled = true;
        try {
          const hh = await switchHousehold(id);
          toast(`انتقلت إلى ${hh.name}`);
          /* البيانات كلها تخصّ البيت السابق — نعيد التشغيل على البيت الجديد */
          persistNow();
          setTimeout(() => location.replace(location.origin + location.pathname), 700);
        } catch (err) {
          btn.disabled = false;
          toast(arabicError(err), 3500);
        }
      });
    },
  };
}

/** الانضمام إلى بيت إضافي بكود دعوة، دون مغادرة البيت الحالي */
export function joinHouseScreen() {
  return {
    title: 'الانضمام إلى بيت',
    back: true,
    html: `
      <div class="card">
        <div class="strong">أدخل كود الدعوة</div>
        <p class="muted small" style="margin:4px 0 0">
          اطلب الكود من مالك البيت. ستبقى عضوًا في بيتك الحالي، ويمكنك التبديل بينهما متى شئت.
        </p>
      </div>
      <div id="err"></div>
      <div class="field mt"><label for="jcode">كود الدعوة</label>
        <input class="input" id="jcode" placeholder="BEITNA-XXXXXX"
               style="direction:ltr;text-align:left" autocapitalize="characters"></div>
      <div class="field"><label for="jname">اسمك في ذلك البيت</label>
        <input class="input" id="jname" placeholder="صالح"></div>
      <button class="btn block" data-act="join">الانضمام</button>`,
    mount(root) {
      const err = (m) => { root.querySelector('#err').innerHTML = `<div class="err">${esc(m)}</div>`; };
      root.querySelector('[data-act="join"]').onclick = async (e) => {
        const code = root.querySelector('#jcode').value.trim().toUpperCase();
        const name = root.querySelector('#jname').value.trim() || getState().profile.name || 'عضو';
        if (!code) return err('أدخل كود الدعوة');
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'جارٍ الانضمام...';
        try {
          const hh = await joinHousehold(code, name);
          toast(`انضممت إلى ${hh.name}`);
          persistNow();
          setTimeout(() => location.replace(location.origin + location.pathname), 800);
        } catch (ex) {
          btn.disabled = false; btn.textContent = 'الانضمام';
          err(arabicError(ex));
        }
      };
    },
  };
}

/* ============================ التصنيفات ============================ */
const CAT_TABS = [
  { id: 'Shopping', label: 'تصنيف مشتريات' },
  { id: 'FaultLocation', label: 'مكان في البيت' },
  { id: 'OccasionType', label: 'نوع تذكير' },
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
const ARCH_TABS = ['مشتريات', 'أعطال', 'تذكيرات'];
let archTab = 'مشتريات';

export function archiveScreen() {
  const a = archiveItems();
  const list = archTab === 'مشتريات' ? a.shopping : archTab === 'أعطال' ? a.faults : a.occasions;

  return {
    title: 'الأرشيف',
    subtitle: 'مشتريات وأعطال وتذكيرات منتهية',
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

const nf = (n) => Number(n || 0).toLocaleString('ar-EG');

/** ورقة إحصائيات النظام — أرقام مجمّعة يجلبها الخادم */
async function openStatsSheet() {
  const close = openSheet('<h3>إحصائيات النظام</h3><p class="muted small">جارٍ التحميل...</p>');
  let st;
  try { st = await loadStats(); }
  catch (e) {
    openSheet(`<h3>إحصائيات النظام</h3><div class="err">${esc(arabicError(e))}</div>
               <button class="btn block" data-close>حسنًا</button>`,
      { onMount(el, c) { el.querySelector('[data-close]').onclick = c; } });
    return;
  }
  close();

  const rows = [
    ['👥', 'إجمالي المستخدمين', nf(st.users)],
    ['🆕', 'مستخدمون جدد (٧ أيام)', nf(st.usersNew7d)],
    ['🆕', 'مستخدمون جدد (٣٠ يومًا)', nf(st.usersNew30d)],
    ['⚡', 'نشطون (٧ أيام)', nf(st.activeUsers7d)],
    ['⚡', 'نشطون (٣٠ يومًا)', nf(st.activeUsers30d)],
    ['🏡', 'عدد البيوت', nf(st.households)],
    ['👨‍👩‍👧', 'بيوت فيها أكثر من فرد', nf(st.householdsShared)],
    ['📊', 'متوسط الأفراد في البيت', nf(st.avgMembers)],
    ['📦', 'إجمالي العناصر', nf(st.itemsTotal)],
    ['💾', 'حجم قاعدة البيانات', nf(Number((st.dbBytes / 1024).toFixed(1))) + ' ك.ب'],
    ['🗄️', 'النسخ الاحتياطية', nf(st.backups || 0)],
    ['🕒', 'آخر نسخة', st.lastBackupAt ? relTime(st.lastBackupAt) : '—'],
  ];

  openSheet(`
    <h3>إحصائيات النظام</h3>
    <div class="list">
      ${rows.map(([ic, t, v]) => `
        <div class="list-row"><span class="ic">${ic}</span>
          <span class="grow"><span class="t">${esc(t)}</span></span>
          <b style="font-size:16px">${esc(v)}</b></div>`).join('')}
    </div>
    <p class="tiny muted mt">أرقام مجمّعة فقط — لا بريد ولا اسم ولا محتوى أي بيت.</p>
    <button class="btn soft block mt" data-backup>🗄️ نسخة احتياطية الآن</button>
    <button class="btn block mt-s" data-close>حسنًا</button>
  `, {
    onMount(el, c) {
      el.querySelector('[data-close]').onclick = c;
      const bk = el.querySelector('[data-backup]');
      if (bk) bk.onclick = async () => {
        bk.disabled = true; bk.textContent = 'جارٍ الحفظ...';
        try { const r = await runBackup(); toast('حُفظت: ' + r.file, 3500); }
        catch (ex) { toast(arabicError(ex), 3500); }
        bk.disabled = false; bk.textContent = '🗄️ نسخة احتياطية الآن';
      };
    },
  });
}

/** حذف الحساب: تأكيد مكتوب ثم كلمة المرور */
async function confirmDeleteAccount() {
  const ok = await confirmDialog({
    title: 'حذف الحساب نهائيًا',
    message: 'سيُحذف حسابك وبياناتك من الخادم بلا رجعة. لا يمكن التراجع عن هذه الخطوة.',
    confirmText: 'متابعة',
    danger: true,
  });
  if (!ok) return;

  openSheet(`
    <h3>تأكيد الحذف</h3>
    <p class="muted small" style="margin:0 0 14px">اكتب كلمة مرور حسابك للتأكيد.</p>
    <div id="err"></div>
    <div class="field"><label for="delpass">كلمة المرور</label>
      <input class="input" id="delpass" type="password" autocomplete="current-password"></div>
    <button class="btn danger block" data-go-del>حذف حسابي نهائيًا</button>
    <button class="btn ghost block mt" data-close>إلغاء</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      const btn = el.querySelector('[data-go-del]');
      btn.onclick = async () => {
        const pass = el.querySelector('#delpass').value;
        if (!pass) return;
        btn.disabled = true; btn.textContent = 'جارٍ الحذف...';
        try {
          const r = await deleteAccount(pass);
          close();
          resetAll();
          persistNow();
          toast(r.householdsDeleted ? 'حُذف حسابك وبيتك نهائيًا' : 'حُذف حسابك نهائيًا');
          setTimeout(() => location.replace(location.origin + location.pathname), 1200);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'حذف حسابي نهائيًا';
          el.querySelector('#err').innerHTML = `<div class="err">${esc(arabicError(e))}</div>`;
        }
      };
    },
  });
}

/* ============================ تصدير البيانات ============================ */

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** CSV بفاصلة مع BOM حتى يفتح Excel العربية بلا تشويه */
const BOM = String.fromCharCode(0xFEFF);
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const QUOTE = String.fromCharCode(34);

function toCsv(rows) {
  const cell = (v) => {
    const text = String(v == null ? '' : v);
    const needsQuotes = text.includes(',') || text.includes(QUOTE) || text.includes(LF);
    return needsQuotes ? QUOTE + text.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : text;
  };
  return BOM + rows.map((r) => r.map(cell).join(',')).join(CRLF);
}

function exportSheet() {
  const s = getState();
  openSheet(`
    <h3>تصدير بيانات بيتك</h3>
    <p class="muted small" style="margin:0 0 14px">
      نسخة كاملة على جهازك. ${esc(s.household.name || '')} —
      ${s.shopping.length} مشتريات، ${s.faults.length} أعطال، ${s.occasions.length} تذكيرات.
    </p>
    <button class="btn block" data-json>📦 ملف JSON — كل شيء</button>
    <button class="btn ghost block mt-s" data-csv>📊 ملف CSV — المشتريات لإكسل</button>
    <button class="btn ghost block mt-s" data-close>إغلاق</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;

      el.querySelector('[data-json]').onclick = () => {
        const st = getState();
        download(`beitna-${stamp()}.json`, JSON.stringify({
          exportedAt: new Date().toISOString(),
          household: { name: st.household.name, inviteCode: undefined },
          profile: { name: st.profile.name, role: st.profile.role },
          members: (st.members || []).map((m) => ({ name: m.name, role: m.role })),
          shopping: st.shopping, faults: st.faults, occasions: st.occasions,
          categories: st.categories, favoriteLists: st.favoriteLists,
        }, null, 2), 'application/json');
        toast('نُزّل ملف JSON ✓');
      };

      el.querySelector('[data-csv]').onclick = () => {
        const st = getState();
        const rows = [['الصنف', 'الكمية', 'التصنيف', 'الأولوية', 'الحالة', 'السعر', 'من أضافه', 'ملاحظة']];
        st.shopping.forEach((i) => rows.push([
          i.name, i.quantity, i.category, i.priority, i.status, i.price, i.owner, i.note,
        ]));
        download(`beitna-shopping-${stamp()}.csv`, toCsv(rows), 'text/csv');
        toast('نُزّل ملف CSV ✓');
      };
    },
  });
}

/** ورقة عرض رمز الاسترداد — يُعرض مرة واحدة فقط */
function recoveryCodeSheet(code) {
  openSheet(`
    <h3>🔑 رمز الاسترداد</h3>
    <p class="muted small" style="margin:0 0 12px">
      احفظه في مكان آمن. هو طريقك الوحيد لاستعادة حسابك إن نسيت كلمة المرور —
      الخادم لا يحفظه نصًا ولا يستطيع إرساله لك لاحقًا. الرمز السابق بطل الآن.
    </p>
    <div class="invite-code">${esc(code)}</div>
    <button class="btn soft block mt" data-copy>📋 نسخ</button>
    <button class="btn block mt-s" data-close>حسنًا</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(code); toast('نُسخ ✓'); } catch { /* تجاهل */ }
      };
      el.querySelector('[data-close]').onclick = close;
    },
  });
}

/** يطلب كلمة المرور الحالية ثم ينفّذ */
function askPassword({ title, note, confirmText, run }) {
  openSheet(`
    <h3>${esc(title)}</h3>
    ${note ? `<p class="muted small" style="margin:0 0 12px">${esc(note)}</p>` : ''}
    <div id="err"></div>
    <div class="field"><label for="curp">كلمة المرور الحالية</label>
      <input class="input" id="curp" type="password" autocomplete="current-password"
             style="direction:ltr;text-align:left"></div>
    <div id="extra"></div>
    <button class="btn block" data-go>${esc(confirmText)}</button>
    <button class="btn ghost block mt-s" data-close>إلغاء</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      const btn = el.querySelector('[data-go]');
      btn.onclick = async () => {
        const cur = el.querySelector('#curp').value;
        if (!cur) return;
        btn.disabled = true; btn.textContent = 'لحظة...';
        try { await run(cur, el, close); }
        catch (ex) {
          btn.disabled = false; btn.textContent = confirmText;
          el.querySelector('#err').innerHTML = `<div class="err">${esc(arabicError(ex))}</div>`;
        }
      };
    },
  });
}

function changePasswordSheet() {
  askPassword({
    title: 'تغيير كلمة المرور',
    note: 'ستُسجَّل خروجًا من كل أجهزتك الأخرى.',
    confirmText: 'تغيير',
    async run(cur, el, close) {
      const extra = el.querySelector('#extra');
      if (!extra.dataset.ready) {
        extra.dataset.ready = '1';
        extra.innerHTML = `
          <div class="field"><label for="newp">كلمة المرور الجديدة</label>
            <input class="input" id="newp" type="password" autocomplete="new-password"
                   style="direction:ltr;text-align:left">
            <div class="hint">6 أحرف على الأقل</div></div>`;
        const btn = el.querySelector('[data-go]');
        btn.disabled = false; btn.textContent = 'تغيير';
        el.querySelector('#newp').focus();
        return;
      }
      const next = el.querySelector('#newp').value;
      if (next.length < 6) throw { code: 'weak-password' };
      await changePassword(cur, next);
      close();
      toast('تم تغيير كلمة المرور ✓');
    },
  });
}

function newRecoverySheet() {
  askPassword({
    title: 'رمز استرداد جديد',
    note: 'الرمز الحالي سيبطل فورًا.',
    confirmText: 'توليد',
    async run(cur, el, close) {
      const r = await newRecoveryCode(cur);
      close();
      recoveryCodeSheet(r.recoveryCode);
    },
  });
}

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

      ${isCloud() ? `
      <div class="section">
        <div class="section-title">الحساب والأمان</div>
        <div class="list">
          <button class="list-row" data-act="chpass"><span class="ic">🔒</span>
            <span class="grow"><span class="t">تغيير كلمة المرور</span>
              <br><span class="d">يُخرج جلساتك على الأجهزة الأخرى</span></span>
            <span class="arrow">‹</span></button>
          <button class="list-row" data-act="newrec"><span class="ic">🔑</span>
            <span class="grow"><span class="t">رمز استرداد جديد</span>
              <br><span class="d">يُعرض مرة واحدة — احفظه</span></span>
            <span class="arrow">‹</span></button>
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-title">حالة الاتصال بالخادم</div>
        <div class="card">
          <div class="small"><span class="muted">الحساب:</span>
            <b style="direction:ltr;display:inline-block">${esc(currentEmail() || '— بدون حساب —')}</b></div>
          <div class="small mt-s"><span class="muted">عنوان الخادم:</span>
            <b style="direction:ltr;display:inline-block;word-break:break-all">${esc(apiBase())}</b></div>
          <div id="srvState" class="small mt-s muted">اضغط «فحص» للتأكد من الوصول.</div>
          <button class="btn ghost block mt" data-act="check">🔌 فحص الاتصال</button>
        </div>
        <p class="tiny muted mt">
          الحساب واحد على كل الأجهزة: نفس البريد يفتح نفس البيت من أي جهاز أو متصفح.
        </p>
      </div>

      <div class="section" id="adminSection" hidden>
        <div class="section-title">إدارة النظام</div>
        <div class="list">
          <button class="list-row" data-act="stats"><span class="ic">📈</span>
            <span class="grow"><span class="t">إحصائيات النظام</span>
              <br><span class="d">عدد المستخدمين والبيوت — أرقام مجمّعة فقط</span></span>
            <span class="arrow">‹</span></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">بياناتك</div>
        <div class="list">
          <button class="list-row" data-act="export"><span class="ic">📦</span>
            <span class="grow"><span class="t">تصدير نسخة من بيانات بيتك</span>
              <br><span class="d">JSON كامل، أو CSV للمشتريات</span></span>
            <span class="arrow">‹</span></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">خطر — منطقة الحذف</div>
        <button class="btn danger-soft block" data-act="reset">🗑️ حذف بيانات هذا الجهاز وإعادة الضبط</button>
        ${isCloud() ? `
          <button class="btn danger block mt" data-act="delacct">⚠️ حذف حسابي نهائيًا من الخادم</button>
          <p class="tiny muted mt-s">
            يمسح حسابك وبياناتك من الخادم بلا رجعة. إن كنت مالك بيت وفيه أعضاء آخرون
            تنتقل الملكية لأقدمهم ويبقى البيت لهم؛ وإن كنت آخر فرد فيه يُحذف البيت كاملًا.
          </p>` : ''}
      </div>

      <p class="center tiny muted mt">إدارة المنزل بذكاء — الإصدار 1.6.1</p>`,
    mount(root) {
      /* قسم الإدارة يظهر فقط إن أكّد الخادم أن هذا الحساب مشرف */
      if (isCloud()) {
        amAdmin().then((ok) => { if (ok) { const el = root.querySelector('#adminSection'); if (el) el.hidden = false; } });
      }

      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="export"]')) { exportSheet(); return; }
        if (e.target.closest('[data-act="chpass"]')) { changePasswordSheet(); return; }
        if (e.target.closest('[data-act="newrec"]')) { newRecoverySheet(); return; }
        if (e.target.closest('[data-act="stats"]')) { openStatsSheet(); return; }

        if (e.target.closest('[data-act="delacct"]')) { await confirmDeleteAccount(); return; }

        if (e.target.closest('[data-act="check"]')) {
          const box = root.querySelector('#srvState');
          box.className = 'small mt-s muted';
          box.textContent = 'جارٍ الفحص...';
          const r = await checkServer({ rediscover: true });
          box.className = 'small mt-s strong';
          box.style.color = r.ok ? 'var(--emerald)' : 'var(--danger)';
          box.textContent = r.ok
            ? (r.canonical
                ? 'متصل بخادم بيتنا الرسمي ✓ — حسابك يتزامن من أي جهاز'
                : 'متصل بخادم على نفس الدومين ✓')
            : 'تعذّر الوصول إلى الخادم — تحقق من الإنترنت ثم أعد الفحص';
          return;
        }

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
