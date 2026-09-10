/* شاشات الأعطال */

import { esc, relTime, fmtDate, toInputDate } from '../util.js';
import {
  getState, categoriesOf, addFault, updateFault, deleteFault,
  FAULT_STATUS, FAULT_PRIORITY, CURRENCY,
} from '../store.js';
import { emptyState, toast, confirmDialog, chipSelect, bindChips, openSheet } from '../ui.js';
import { go, back } from '../router.js';

const FILTERS = ['الكل', 'الجديدة', 'قيد المتابعة', 'بانتظار فني', 'تم الإصلاح'];
const FILTER_MAP = { 'الجديدة': 'جديد', 'قيد المتابعة': 'قيد المتابعة', 'بانتظار فني': 'بانتظار فني', 'تم الإصلاح': 'تم الإصلاح' };

let filter = 'الكل';

const locIcon = (name) => categoriesOf('FaultLocation').find((c) => c.name === name)?.icon || '🏠';
const prioTone = (p) => (p === 'عاجل' ? 'danger' : p === 'متوسط' ? 'warn' : 'gray');
const statusTone = (s) => (s === 'تم الإصلاح' ? '' : s === 'بانتظار فني' ? 'info' : s === 'قيد المتابعة' ? 'warn' : 'danger');

/* ============================ القائمة ============================ */
export function faultsScreen() {
  const s = getState();
  let items = s.faults;
  if (filter !== 'الكل') items = items.filter((f) => f.status === FILTER_MAP[filter]);

  const open = s.faults.filter((f) => f.status !== 'تم الإصلاح').length;
  const fixed = s.faults.length - open;

  return {
    title: 'الأعطال',
    subtitle: `${open} أعطال بين جديدة وتحت المتابعة`,
    fab: { label: '＋ إضافة عطل', to: '/faults/new' },
    html: `
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><div class="n">${open}</div><div class="l">تحتاج متابعة</div></div>
        <div class="stat"><div class="n">${fixed}</div><div class="l">تم إصلاحها</div></div>
        <div class="stat"><div class="n">${s.faults.reduce((a, f) => a + (f.actualCost || f.estimatedCost || 0), 0).toFixed(0)}</div><div class="l">التكاليف ${CURRENCY}</div></div>
      </div>

      <div class="filters">
        ${FILTERS.map((f) => `<button class="filter ${f === filter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('')}
      </div>

      <div class="stack mt-s">
        ${items.length ? items.map(row).join('')
          : emptyState('🔧', 'لا توجد أعطال هنا', 'جرّب إضافة عطل جديد أو غيّر الفلتر')}
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        const f = e.target.closest('[data-filter]');
        if (f) { filter = f.dataset.filter; rerender(); return; }
        const o = e.target.closest('[data-open]');
        if (o) go(`/faults/${o.dataset.open}`);
      });
    },
  };
}

function row(f) {
  return `
    <div class="item tap ${f.status === 'تم الإصلاح' ? 'done' : ''}" data-open="${f.id}">
      <div class="avatar">${locIcon(f.location)}</div>
      <div class="grow col">
        <div class="title">${esc(f.title)}</div>
        <div class="meta">
          <span>${esc(f.location || 'غير محدد')}</span>
          <span class="badge ${prioTone(f.priority)}">${esc(f.priority)}</span>
          <span class="badge ${statusTone(f.status)}">${esc(f.status)}</span>
          ${f.photoUrl ? '<span>📷</span>' : ''}
        </div>
      </div>
      <span class="muted">‹</span>
    </div>`;
}

/* ============================ النموذج ============================ */
export function faultFormScreen() {
  const locs = categoriesOf('FaultLocation');
  return {
    title: 'عطل جديد',
    back: true,
    html: `
      <div class="card">
        <div id="err"></div>
        <div class="field">
          <label for="title">عنوان العطل</label>
          <input class="input" id="title" placeholder="تسريب في الحنفية" autocomplete="off">
        </div>
        <div class="field">
          <label>المكان</label>
          ${chipSelect('location', locs.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` })), locs[0]?.name)}
        </div>
        <div class="field">
          <label>الأولوية</label>
          ${chipSelect('priority', FAULT_PRIORITY, 'متوسط')}
        </div>
        <div class="field">
          <label for="cost">التكلفة التقديرية (${CURRENCY})</label>
          <input class="input" id="cost" type="number" inputmode="decimal" step="0.001" placeholder="0">
        </div>
        <div class="field">
          <label for="photo">صورة العطل (اختياري)</label>
          <input class="input" id="photo" type="file" accept="image/*">
          <div class="hint">اضغط لاختيار صورة من المعرض — تُحفظ داخل جهازك فقط.</div>
          <img id="preview" class="photo mt-s" hidden alt="معاينة صورة العطل">
        </div>
        <div class="field">
          <label for="note">الوصف / الملاحظات</label>
          <textarea class="input" id="note" placeholder="اختياري"></textarea>
        </div>
        <button class="btn block" data-save>حفظ العطل</button>
      </div>`,
    mount(root) {
      const values = bindChips(root);
      let photoUrl = '';

      root.querySelector('#photo').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        photoUrl = await downscale(file);
        const img = root.querySelector('#preview');
        img.src = photoUrl; img.hidden = false;
      });

      root.querySelector('[data-save]').onclick = () => {
        const title = root.querySelector('#title').value.trim();
        if (!title) { root.querySelector('#err').innerHTML = `<div class="err">اكتب عنوان العطل</div>`; return; }
        addFault({
          title,
          location: values.location,
          priority: values.priority,
          note: root.querySelector('#note').value.trim(),
          estimatedCost: root.querySelector('#cost').value,
          photoUrl,
        });
        toast(`تم تسجيل عطل: ${title}`);
        go('/faults', { replace: true });
      };
      root.querySelector('#title')?.focus();
    },
  };
}

/** تصغير الصورة قبل تخزينها محليًا */
function downscale(file, max = 1000, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve('');
      img.src = reader.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/* ============================ التفاصيل ============================ */
export function faultDetailsScreen({ id }) {
  const f = getState().faults.find((x) => x.id === Number(id));
  if (!f) return { title: 'تفاصيل العطل', back: true, html: emptyState('🔧', 'العطل غير موجود', 'قد يكون تم حذفه أو تغييره') };

  return {
    title: 'تفاصيل العطل',
    back: true,
    html: `
      <div class="card">
        <div class="row" style="gap:14px">
          <div style="width:54px;height:54px;border-radius:16px;background:var(--mint);display:grid;place-items:center;font-size:26px">${locIcon(f.location)}</div>
          <div class="grow">
            <div style="font-size:19px;font-weight:800">${esc(f.title)}</div>
            <div class="muted small">${esc(f.location || 'غير محدد')}</div>
          </div>
        </div>
        ${f.photoUrl ? `<img class="photo mt" src="${f.photoUrl}" alt="صورة العطل">` : ''}
        <hr class="divider">
        <div class="kv"><span class="k">الحالة</span><span class="v"><span class="badge ${statusTone(f.status)}">${esc(f.status)}</span></span></div>
        <div class="kv"><span class="k">الأولوية</span><span class="v"><span class="badge ${prioTone(f.priority)}">${esc(f.priority)}</span></span></div>
        <div class="kv"><span class="k">التكلفة التقديرية</span><span class="v">${f.estimatedCost ? `${f.estimatedCost} ${CURRENCY}` : '—'}</span></div>
        <div class="kv"><span class="k">التكلفة الفعلية</span><span class="v">${f.actualCost ? `${f.actualCost} ${CURRENCY}` : '—'}</span></div>
        ${f.repairDate ? `<div class="kv"><span class="k">موعد الإصلاح</span><span class="v">${esc(fmtDate(f.repairDate))}${f.technician ? ` — ${esc(f.technician)}` : ''}</span></div>` : ''}
        <div class="kv"><span class="k">سُجّل</span><span class="v">${esc(relTime(f.createdAt))}</span></div>
        ${f.note ? `<hr class="divider"><div class="small"><span class="muted">ملاحظة:</span> ${esc(f.note)}</div>` : ''}
      </div>

      <div class="section">
        <div class="section-title">تغيير الحالة</div>
        <div class="chip-select">
          ${FAULT_STATUS.map((st) => `<button class="chip-opt ${st === f.status ? 'active' : ''}" data-status="${esc(st)}">${esc(st)}</button>`).join('')}
        </div>
      </div>

      <div class="mt stack">
        <button class="btn ghost block" data-schedule>🗓️ جدولة إصلاح</button>
        <button class="btn ghost block" data-cost>💰 تسجيل التكلفة الفعلية</button>
        <button class="btn danger-soft block" data-del>🗑️ حذف العطل</button>
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-status]');
        if (st) { updateFault(f.id, { status: st.dataset.status }); toast('تم التحديث ✓'); rerender(); return; }

        if (e.target.closest('[data-schedule]')) {
          openSheet(`
            <h3>جدولة الإصلاح</h3>
            <div class="field"><label for="tech">اسم الفني</label>
              <input class="input" id="tech" placeholder="فني سباكة" value="${esc(f.technician || '')}"></div>
            <div class="field"><label for="rdate">التاريخ</label>
              <input class="input" id="rdate" type="date" value="${f.repairDate ? toInputDate(f.repairDate) : toInputDate(Date.now())}"></div>
            <button class="btn block" id="rsave">حفظ الموعد</button>
          `, {
            onMount(sheet, close) {
              sheet.querySelector('#rsave').onclick = () => {
                updateFault(f.id, {
                  technician: sheet.querySelector('#tech').value.trim(),
                  repairDate: new Date(sheet.querySelector('#rdate').value).getTime(),
                  status: 'بانتظار فني',
                });
                close(); toast('تم حفظ الموعد ✓'); rerender();
              };
            },
          });
          return;
        }

        if (e.target.closest('[data-cost]')) {
          openSheet(`
            <h3>تسجيل التكلفة</h3>
            <div class="field"><label for="est">التكلفة التقديرية (${CURRENCY})</label>
              <input class="input" id="est" type="number" step="0.001" value="${f.estimatedCost || ''}"></div>
            <div class="field"><label for="act">التكلفة الفعلية (${CURRENCY})</label>
              <input class="input" id="act" type="number" step="0.001" value="${f.actualCost || ''}"></div>
            <button class="btn block" id="csave">حفظ</button>
          `, {
            onMount(sheet, close) {
              sheet.querySelector('#csave').onclick = () => {
                updateFault(f.id, {
                  estimatedCost: parseFloat(sheet.querySelector('#est').value) || 0,
                  actualCost: parseFloat(sheet.querySelector('#act').value) || 0,
                });
                close(); toast('تم الحفظ ✓'); rerender();
              };
            },
          });
          return;
        }

        if (e.target.closest('[data-del]')) {
          const ok = await confirmDialog({
            title: 'حذف العطل',
            message: `هل أنت متأكد من حذف "${f.title}"؟ لا يمكن استرجاع العطل بعد الحذف.`,
            confirmText: 'حذف', danger: true,
          });
          if (ok) { deleteFault(f.id); toast('تم حذف عطل'); back('/faults'); }
        }
      });
    },
  };
}
