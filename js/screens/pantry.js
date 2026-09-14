/* ============================================================
   قائمة الاحتياجات — مخزون البيت
   قائمة دائمة تمرّ عليها أسبوعيًا أو شهريًا: ✓ متوفر، وإزالة
   العلامة تعني «نفد». ثم ترسل الناقص كله إلى المشتريات بضغطة.
   لا تُستهلك بالشراء — تبقى كما هي للمرة القادمة.
   ============================================================ */

import { esc, haptic } from '../util.js';
import {
  getState, seedPantry, addPantryItem, setPantryStock, removePantryItem,
  sendNeededToShopping, resetPantryReview,
} from '../store.js';
import { PANTRY_CATEGORIES } from '../pantry-data.js';
import { emptyState, toast, confirmDialog, openSheet } from '../ui.js';
import { go } from '../router.js';

let openCat = null;      // القسم المفتوح
let onlyNeeded = false;  // عرض الناقص فقط
let query = '';

export function pantryScreen() {
  const s = getState();
  const all = s.pantry || [];

  if (!all.length) return emptyPantry();

  const q = query.trim();
  const match = (p) => (!q || p.name.includes(q)) && (!onlyNeeded || !p.stocked);
  const needed = all.filter((p) => !p.stocked);
  const pct = all.length ? Math.round(((all.length - needed.length) / all.length) * 100) : 0;

  const groups = PANTRY_CATEGORIES
    .map((c) => ({ cat: c, items: all.filter((p) => p.cat === c.id && match(p)) }))
    .filter((g) => g.items.length);

  return {
    title: 'قائمة الاحتياجات',
    subtitle: needed.length ? `${needed.length} صنفًا نفد` : 'كل شيء متوفر',
    back: true,
    actions: `<button class="icon-btn" data-act="add" title="إضافة صنف">＋</button>`,
    html: `
      <div class="card" style="margin-bottom:12px">
        <div class="row between" style="margin-bottom:8px">
          <span class="small strong">المتوفر</span>
          <span class="small muted">${all.length - needed.length} من ${all.length} • ${pct}%</span>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${needed.length ? `
          <button class="btn block mt-s" data-send>🛒 أرسل الناقص إلى المشتريات (${needed.length})</button>
        ` : ''}
        <button class="btn ghost block mt-s" data-review>🔄 بدء مراجعة جديدة</button>
      </div>

      <div class="search" style="margin-bottom:10px">
        <span>🔍</span>
        <input id="pq" placeholder="ابحث عن صنف" value="${esc(query)}">
      </div>

      <div class="filters">
        <button class="filter ${onlyNeeded ? '' : 'active'}" data-f="all">الكل (${all.length})</button>
        <button class="filter ${onlyNeeded ? 'active' : ''}" data-f="need">الناقص (${needed.length})</button>
      </div>

      <div class="stack mt-s">
        ${groups.length ? groups.map(groupCard).join('')
          : emptyState('🔍', 'لا توجد نتائج', 'جرّب كلمة أخرى أو أعد الفلتر إلى «الكل»')}
      </div>

      <p class="tiny muted center mt">
        هذه القائمة دائمة — لا تُحذف بالشراء.<br>
        الطلبات المستعجلة ضعها مباشرة في «المشتريات».
      </p>`,

    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const head = e.target.closest('[data-cat]');
        if (head) {
          openCat = openCat === head.dataset.cat ? null : head.dataset.cat;
          rerender(); return;
        }

        const tick = e.target.closest('[data-tick]');
        if (tick) {
          const id = Number(tick.dataset.tick);
          const p = getState().pantry.find((x) => x.id === id);
          if (p) setPantryStock(id, !p.stocked);
          haptic(15);
          rerender(); return;
        }

        const del = e.target.closest('[data-del]');
        if (del) {
          const id = Number(del.dataset.del);
          const p = getState().pantry.find((x) => x.id === id);
          const ok = await confirmDialog({
            title: 'حذف من القائمة',
            message: `حذف "${p ? p.name : ''}" من قائمة الاحتياجات نهائيًا؟`,
            confirmText: 'حذف', danger: true,
          });
          if (ok) { removePantryItem(id); toast('حُذف من القائمة'); rerender(); }
          return;
        }

        const f = e.target.closest('[data-f]');
        if (f) { onlyNeeded = f.dataset.f === 'need'; rerender(); return; }

        if (e.target.closest('[data-send]')) {
          const n = sendNeededToShopping();
          toast(n ? `أُضيف ${n} صنفًا إلى المشتريات ✓` : 'كل الناقص موجود في المشتريات أصلًا');
          if (n) go('/shopping');
          return;
        }

        if (e.target.closest('[data-review]')) {
          const ok = await confirmDialog({
            title: 'بدء مراجعة جديدة',
            message: 'سيُعاد كل صنف إلى «متوفر»، ثم تمرّ على القائمة وتُزيل علامة ما نفد.',
            confirmText: 'ابدأ',
          });
          if (ok) { resetPantryReview(); toast('جاهز — أزل علامة ما نفد'); rerender(); }
        }
      });

      const qi = root.querySelector('#pq');
      if (qi) {
        qi.addEventListener('input', () => {
          query = qi.value;
          const pos = qi.selectionStart;
          rerender();
          const n = document.querySelector('#pq');
          if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        });
      }
    },

    topActions(act, rerender) {
      if (act === 'add') addSheet(rerender);
    },
  };
}

function groupCard({ cat, items }) {
  const need = items.filter((p) => !p.stocked).length;
  const open = openCat === cat.id || !!query.trim() || onlyNeeded;
  return `
    <div class="card" style="padding:0;overflow:hidden">
      <button class="list-row" data-cat="${esc(cat.id)}" style="width:100%">
        <span class="ic">${cat.icon}</span>
        <span class="grow"><span class="t">${esc(cat.name)}</span><br>
          <span class="d">${items.length} صنفًا${need ? ` — ${need} نفد` : ''}</span></span>
        <span class="arrow">${open ? '⌄' : '‹'}</span>
      </button>
      ${open ? items.map(itemRow).join('') : ''}
    </div>`;
}

function itemRow(p) {
  return `
    <div class="item" style="border-top:1px solid var(--line)">
      <button class="check ${p.stocked ? 'on' : ''}" data-tick="${p.id}"
              aria-label="${p.stocked ? 'متوفر' : 'نفد'}">✓</button>
      <div class="grow col">
        <div class="title">${esc(p.name)}</div>
        ${p.stocked ? '' : '<div class="meta"><span class="badge warn">نفد</span></div>'}
      </div>
      <button class="icon-btn" data-del="${p.id}" title="حذف">🗑️</button>
    </div>`;
}

function emptyPantry() {
  return {
    title: 'قائمة الاحتياجات',
    back: true,
    html: `
      <div class="card center">
        <div class="empty">
          <div class="ic">📋</div>
          <h3>قائمة احتياجات البيت</h3>
          <p class="muted">قائمة دائمة تمرّ عليها كل أسبوع أو شهر:
            تُزيل علامة ما نفد، ثم ترسله كله إلى المشتريات بضغطة.
            لا تُستهلك بالشراء — تبقى كما هي.</p>
        </div>
        <button class="btn block" data-seed>📥 ابدأ بالقائمة الجاهزة</button>
        <button class="btn ghost block mt-s" data-blank>ابدأ من الصفر</button>
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-seed]')) {
          const n = seedPantry();
          toast(`تم استيراد ${n} صنفًا ✓`);
          rerender(); return;
        }
        if (e.target.closest('[data-blank]')) addSheet(rerender);
      });
    },
  };
}

function addSheet(rerender) {
  openSheet(`
    <h3>إضافة صنف للاحتياجات</h3>
    <div class="field"><label for="pname">اسم الصنف</label>
      <input class="input" id="pname" placeholder="تونة" autocomplete="off"></div>
    <div class="field"><label for="pcat">القسم</label>
      <select class="input" id="pcat">
        ${PANTRY_CATEGORIES.map((c) => `<option value="${esc(c.id)}">${c.icon} ${esc(c.name)}</option>`).join('')}
      </select></div>
    <button class="btn block" id="padd">إضافة</button>
  `, {
    onMount(sheet, close) {
      sheet.querySelector('#padd').onclick = () => {
        const name = sheet.querySelector('#pname').value.trim();
        if (!name) return toast('اكتب اسم الصنف');
        addPantryItem({ name, cat: sheet.querySelector('#pcat').value });
        close(); toast(`أُضيف "${name}" ✓`); rerender();
      };
      sheet.querySelector('#pname').focus();
    },
  });
}
