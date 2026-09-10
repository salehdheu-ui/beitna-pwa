/* شاشات المناسبات */

import { esc, fmtDate, fmtTime, countdownText, todayStart, toInputDate, monthName, dayName, startOfDay } from '../util.js';
import {
  getState, categoriesOf, addOccasion, updateOccasion, completeOccasion, deleteOccasion,
  REMINDER_OFFSETS,
} from '../store.js';
import { emptyState, toast, confirmDialog, chipSelect, bindChips, openSheet } from '../ui.js';
import { go, back } from '../router.js';
import { iconForType } from './home.js';

const TABS = ['القادمة', 'اليوم', 'هذا الأسبوع', 'المتكررة', 'التقويم'];
let tab = 'القادمة';
let calCursor = new Date();

/* ============================ القائمة ============================ */
export function occasionsScreen() {
  const s = getState();
  const today = todayStart();
  const week = today + 7 * 86400000;
  const active = s.occasions.filter((o) => !o.done);

  let items;
  if (tab === 'القادمة') items = active.filter((o) => o.dateMillis >= today);
  else if (tab === 'اليوم') items = active.filter((o) => o.dateMillis === today);
  else if (tab === 'هذا الأسبوع') items = active.filter((o) => o.dateMillis >= today && o.dateMillis <= week);
  else if (tab === 'المتكررة') items = active.filter((o) => o.recurring && o.recurring !== 'بدون');
  else items = active;

  items = [...items].sort((a, b) => a.dateMillis - b.dateMillis);

  return {
    title: 'مناسبات البيت',
    subtitle: `${items.length} مناسبة في هذا العرض`,
    fab: { label: '＋ إضافة مناسبة', to: '/occasions/new' },
    html: `
      <div class="tabs" style="margin-bottom:12px">
        ${TABS.map((t) => `<button class="tab ${t === tab ? 'active' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>

      ${tab === 'التقويم' ? calendarHtml(active) : `
        <div class="stack">
          ${items.length ? items.map(row).join('')
            : emptyState('🎉', 'لا توجد مناسبات', 'أضف أول مناسبة أو تذكير عائلي')}
        </div>`}
    `,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; rerender(); return; }
        const o = e.target.closest('[data-open]');
        if (o) { go(`/occasions/${o.dataset.open}`); return; }
        const nav = e.target.closest('[data-cal]');
        if (nav) {
          calCursor.setMonth(calCursor.getMonth() + Number(nav.dataset.cal));
          calCursor = new Date(calCursor);
          rerender();
        }
      });
    },
  };
}

function row(o) {
  const days = Math.round((o.dateMillis - todayStart()) / 86400000);
  const tone = days < 0 ? 'gray' : days <= 3 ? 'danger' : days <= 7 ? 'warn' : '';
  return `
    <div class="item tap" data-open="${o.id}">
      <div class="avatar">${iconForType(o.type)}</div>
      <div class="grow col">
        <div class="title">${esc(o.title)}</div>
        <div class="meta">
          <span>${esc(fmtDate(o.dateMillis))}</span>
          <span class="badge ${tone}">${esc(countdownText(o.dateMillis))}</span>
          ${o.recurring && o.recurring !== 'بدون' ? `<span class="badge info">🔁 ${esc(o.recurring)}</span>` : ''}
        </div>
      </div>
      <span class="muted">‹</span>
    </div>`;
}

/* ============================ التقويم ============================ */
function calendarHtml(items) {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = todayStart();

  const marks = new Set(items.map((o) => startOfDay(o.dateMillis)));
  const cells = [];

  for (let i = startDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ts = new Date(y, m, d).setHours(0, 0, 0, 0);
    cells.push({ d, ts, today: ts === today, has: marks.has(ts) });
  }
  let trail = 1;
  while (cells.length % 7 !== 0) cells.push({ d: trail++, other: true });

  const monthItems = items
    .filter((o) => { const d = new Date(o.dateMillis); return d.getFullYear() === y && d.getMonth() === m; })
    .sort((a, b) => a.dateMillis - b.dateMillis);

  return `
    <div class="cal">
      <div class="cal-head">
        <button class="icon-btn" data-cal="-1">›</button>
        <span class="m">${monthName(m)} ${y}</span>
        <button class="icon-btn" data-cal="1">‹</button>
      </div>
      <div class="cal-grid">
        ${['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map((w) => `<div class="wd">${w}</div>`).join('')}
        ${cells.map((c) => `<div class="cal-day ${c.other ? 'other' : ''} ${c.today ? 'today' : ''} ${c.has ? 'has' : ''}">${c.d}</div>`).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-title">مناسبات ${monthName(m)}</div>
      <div class="stack">
        ${monthItems.length ? monthItems.map(row).join('') : `<div class="card center muted small" style="padding:20px">لا توجد مناسبات في هذا الشهر</div>`}
      </div>
    </div>`;
}

/* ============================ النموذج ============================ */
export function occasionFormScreen() {
  const types = categoriesOf('OccasionType');
  const typeOpts = [...types.map((t) => ({ value: t.name, label: `${t.icon} ${t.name}` })), { value: 'مناسبة عامة', label: '🎉 مناسبة عامة' }];

  return {
    title: 'مناسبة جديدة',
    back: true,
    html: `
      <div class="card">
        <div id="err"></div>
        <div class="field">
          <label for="title">اسم المناسبة</label>
          <input class="input" id="title" placeholder="عيد ميلاد سارة" autocomplete="off">
        </div>
        <div class="field">
          <label>النوع</label>
          ${chipSelect('type', typeOpts, typeOpts[0]?.value)}
        </div>
        <div class="field">
          <label for="date">التاريخ</label>
          <input class="input" id="date" type="date" value="${toInputDate(Date.now() + 86400000)}">
        </div>
        <div class="field">
          <label for="time">وقت التذكير</label>
          <input class="input" id="time" type="time" value="09:00">
        </div>
        <div class="field">
          <label>التذكير</label>
          <div class="chip-select" id="offs">
            ${REMINDER_OFFSETS.map((o) => `<button type="button" class="chip-opt ${o.id === 'DAY' ? 'active' : ''}" data-off="${o.id}">${esc(o.label)}</button>`).join('')}
          </div>
          <div class="hint">يمكن اختيار أكثر من تذكير — أو إلغاء الكل لجعلها بدون تذكير.</div>
        </div>
        <div class="field">
          <label>التكرار</label>
          ${chipSelect('recurring', ['بدون', 'سنويًا', 'شهريًا', 'أسبوعيًا'], 'بدون')}
        </div>
        <div class="field">
          <label for="note">ملاحظات</label>
          <textarea class="input" id="note" placeholder="اختياري"></textarea>
        </div>
        <button class="btn block" data-save>حفظ المناسبة</button>
      </div>`,
    mount(root) {
      const values = bindChips(root);
      const offs = new Set(['DAY']);
      root.querySelector('#offs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-off]');
        if (!b) return;
        const id = b.dataset.off;
        if (offs.has(id)) { offs.delete(id); b.classList.remove('active'); }
        else { offs.add(id); b.classList.add('active'); }
      });

      root.querySelector('[data-save]').onclick = () => {
        const title = root.querySelector('#title').value.trim();
        const date = root.querySelector('#date').value;
        if (!title) { root.querySelector('#err').innerHTML = `<div class="err">اكتب اسم المناسبة</div>`; return; }
        if (!date) { root.querySelector('#err').innerHTML = `<div class="err">اختر تاريخ المناسبة</div>`; return; }
        addOccasion({
          title,
          type: values.type,
          dateMillis: new Date(date + 'T00:00:00').getTime(),
          reminderTime: root.querySelector('#time').value || '09:00',
          reminderOffsets: [...offs],
          recurring: values.recurring,
          note: root.querySelector('#note').value.trim(),
        });
        toast(`تمت إضافة مناسبة: ${title}`);
        go('/occasions', { replace: true });
      };
      root.querySelector('#title')?.focus();
    },
  };
}

/* ============================ التفاصيل ============================ */
export function occasionDetailsScreen({ id }) {
  const o = getState().occasions.find((x) => x.id === Number(id));
  if (!o) return { title: 'تفاصيل المناسبة', back: true, html: emptyState('🎉', 'المناسبة غير موجودة', 'ربما تم إنهاؤها أو حذفها') };

  const offLabels = (o.reminderOffsets || []).map((x) => REMINDER_OFFSETS.find((r) => r.id === x)?.label).filter(Boolean);
  const d = new Date(o.dateMillis);

  return {
    title: 'تفاصيل المناسبة',
    back: true,
    html: `
      <div class="hero" style="background:linear-gradient(150deg,var(--emerald),var(--emerald-dark))">
        <div style="font-size:36px">${iconForType(o.type)}</div>
        <h2 style="margin-top:6px">${esc(o.title)}</h2>
        <p>${esc(dayName(d.getDay()))} — ${esc(fmtDate(o.dateMillis))}</p>
        <div class="chips"><span class="chip">${esc(countdownText(o.dateMillis))}</span>
        ${o.recurring && o.recurring !== 'بدون' ? `<span class="chip">🔁 ${esc(o.recurring)}</span>` : ''}</div>
      </div>

      <div class="card mt">
        <div class="kv"><span class="k">النوع</span><span class="v">${esc(o.type)}</span></div>
        <div class="kv"><span class="k">وقت التذكير</span><span class="v">${esc(fmtTime(o.reminderTime))}</span></div>
        <div class="kv"><span class="k">التذكير</span><span class="v">${offLabels.length ? esc(offLabels.join('، ')) : 'بدون تذكير'}</span></div>
        ${o.note ? `<hr class="divider"><div class="small"><span class="muted">ملاحظة:</span> ${esc(o.note)}</div>` : ''}
      </div>

      ${o.recurring === 'سنويًا' ? `<div class="card mt small muted">هذه مناسبة سنوية. ستتجدّد تلقائيًا للسنة القادمة بنفس الوقت والتذكير.</div>` : ''}

      <div class="mt stack">
        <button class="btn ghost block" data-edit>⏰ تعديل التذكير</button>
        <button class="btn block" data-done>${o.recurring === 'سنويًا' ? '🔄 تمت — جدّد للسنة القادمة' : '✓ تمت المناسبة'}</button>
        <button class="btn danger-soft block" data-del>🗑️ حذف المناسبة</button>
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-edit]')) {
          openSheet(`
            <h3>تعديل التذكير</h3>
            <div class="field"><label for="etime">وقت التذكير</label>
              <input class="input" id="etime" type="time" value="${esc(o.reminderTime || '09:00')}"></div>
            <div class="field"><label for="edate">التاريخ</label>
              <input class="input" id="edate" type="date" value="${toInputDate(o.dateMillis)}"></div>
            <div class="field"><label>قبل المناسبة بـ</label>
              <div class="chip-select" id="eoffs">
                ${REMINDER_OFFSETS.map((r) => `<button type="button" class="chip-opt ${(o.reminderOffsets || []).includes(r.id) ? 'active' : ''}" data-off="${r.id}">${esc(r.label)}</button>`).join('')}
              </div></div>
            <button class="btn block" id="esave">حفظ</button>
          `, {
            onMount(sheet, close) {
              const offs = new Set(o.reminderOffsets || []);
              sheet.querySelector('#eoffs').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-off]');
                if (!b) return;
                const idd = b.dataset.off;
                if (offs.has(idd)) { offs.delete(idd); b.classList.remove('active'); }
                else { offs.add(idd); b.classList.add('active'); }
              });
              sheet.querySelector('#esave').onclick = () => {
                updateOccasion(o.id, {
                  reminderTime: sheet.querySelector('#etime').value,
                  dateMillis: new Date(sheet.querySelector('#edate').value + 'T00:00:00').getTime(),
                  reminderOffsets: [...offs],
                  reminder: offs.size ? 'مفعّل' : 'بدون تذكير',
                });
                close(); toast('تم تعديل تذكير المناسبة'); rerender();
              };
            },
          });
          return;
        }

        if (e.target.closest('[data-done]')) {
          const ok = await confirmDialog({
            title: o.recurring === 'سنويًا' ? 'تجديد المناسبة السنوية' : 'تمت المناسبة',
            message: o.recurring === 'سنويًا'
              ? 'أعياد الميلاد ستتجدّد تلقائيًا كل سنة. هل تريد التجديد الآن؟'
              : 'هل تريد إنهاء المناسبة وحذفها من القائمة؟',
            confirmText: 'تأكيد',
          });
          if (ok) { completeOccasion(o.id); toast('تم ✓'); back('/occasions'); }
          return;
        }

        if (e.target.closest('[data-del]')) {
          const ok = await confirmDialog({
            title: 'حذف المناسبة', message: `هل أنت متأكد من حذف "${o.title}"؟`,
            confirmText: 'حذف', danger: true,
          });
          if (ok) { deleteOccasion(o.id); toast('تم حذف مناسبة'); back('/occasions'); }
        }
      });
    },
  };
}
