/* ============================================================
   قائمة الاحتياجات — مخزون البيت
   قائمة دائمة تمرّ عليها أسبوعيًا أو شهريًا: ✓ متوفر، وإزالة
   العلامة تعني «نفد». ثم ترسل الناقص كله إلى المشتريات بضغطة.
   لا تُستهلك بالشراء — تبقى كما هي للمرة القادمة.
   ============================================================ */

import { esc, haptic } from '../util.js';
import {
  getState, seedPantry, addPantryItem, setPantryStock, removePantryItem,
  sendNeededToShopping, resetPantryReview, fixPantryIds, pantryMissing, completePantry,
  pantryCategoriesOf, addPantryCategory, updatePantryItem,
} from '../store.js';
import { emptyState, toast, confirmDialog, openSheet } from '../ui.js';
import { go } from '../router.js';

let openCat = null;      // القسم المفتوح
let onlyNeeded = false;  // عرض الناقص فقط
let query = '';

/* المعرّفات المتصادمة تُفكّ بصمت — عيب تقني لا يعني المستخدم شيئًا.
   أما استعادة ما ضاع من القائمة الجاهزة فبزرّ يراه ويقرّره هو. */
const HIDE_FILL = 'beitna:pantry-fill-hidden';
let idsFixed = false;

export function pantryScreen() {
  if (!idsFixed) { idsFixed = true; fixPantryIds(); }
  const s = getState();
  const all = s.pantry || [];
  const categories = pantryCategoriesOf();

  if (!all.length) return emptyPantry(categories);

  const q = query.trim();
  const match = (p) => (!q || p.name.includes(q)) && (!onlyNeeded || !p.stocked);
  const needed = all.filter((p) => !p.stocked);
  const pct = all.length ? Math.round(((all.length - needed.length) / all.length) * 100) : 0;

  const groups = categories
    .map((c) => ({ cat: c, items: all.filter((p) => p.cat === c.id && match(p)) }))
    .filter((g) => g.items.length || (g.cat.custom && !q && !onlyNeeded));

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

      <div class="pantry-manage" aria-label="إدارة قائمة الاحتياجات">
        <button class="btn soft" data-add-product>＋ إضافة منتج</button>
        <button class="btn ghost" data-add-category>🏷️ إضافة قسم</button>
      </div>

      ${fillHtml()}

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

        const edit = e.target.closest('[data-edit]');
        if (edit) {
          const item = getState().pantry.find((x) => x.id === Number(edit.dataset.edit));
          if (item) itemSheet(rerender, item);
          return;
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

        if (e.target.closest('[data-fill]')) {
          const n = completePantry();
          toast(n ? `أُضيف ${n} صنفًا من القائمة الجاهزة ✓` : 'قائمتك مكتملة');
          rerender(); return;
        }
        if (e.target.closest('[data-fill-no]')) {
          try { localStorage.setItem(HIDE_FILL, '1'); } catch { /* تجاهل */ }
          rerender(); return;
        }

        if (e.target.closest('[data-add-product]')) { itemSheet(rerender); return; }
        if (e.target.closest('[data-add-category]')) { categorySheet(rerender); return; }

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
          if (n) { n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); }
        });
      }
    },

    topActions(act, rerender) {
      if (act === 'add') itemSheet(rerender);
    },
  };
}

/**
 * استيرادٌ قديم نزل ناقصًا (تصادم المعرّفات كان يأكل نحو الثلث)، أو أصنافٌ
 * حُذفت بقصد. لا نُضيف شيئًا من تلقائنا — نعرض العدد ونترك القرار.
 */
function fillHtml() {
  let hidden = false;
  try { hidden = localStorage.getItem(HIDE_FILL) === '1'; } catch { /* تجاهل */ }
  const n = pantryMissing().length;
  if (hidden || n < 5) return '';
  return `
    <div class="card" style="margin-bottom:12px">
      <div class="row between">
        <div class="grow">
          <div class="small strong">${n} صنفًا من القائمة الجاهزة غير موجود عندك</div>
          <div class="tiny muted">إن كنت حذفتها بقصد فتجاهل هذا.</div>
        </div>
        <button class="icon-btn" data-fill-no aria-label="تجاهل">✕</button>
      </div>
      <button class="btn sm block mt-s" data-fill>📥 أضِفها إلى قائمتي</button>
    </div>`;
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
      ${open && !items.length ? '<div class="tiny muted center" style="padding:14px">لا توجد منتجات في هذا القسم بعد</div>' : ''}
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
      <button class="icon-btn" data-edit="${p.id}" title="تعديل" aria-label="تعديل ${esc(p.name)}">✏️</button>
      <button class="icon-btn" data-del="${p.id}" title="حذف">🗑️</button>
    </div>`;
}

function emptyPantry(categories) {
  const custom = categories.filter((c) => c.custom);
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
        <button class="btn ghost block mt-s" data-blank>＋ إضافة أول منتج</button>
        <button class="btn soft block mt-s" data-add-category>🏷️ إضافة قسم جديد</button>
      </div>
      ${custom.length ? `<div class="card mt-s">
        <div class="small strong">الأقسام التي أضفتها</div>
        <div class="chips mt-s">${custom.map((c) => `<span class="chip">${c.icon} ${esc(c.name)}</span>`).join('')}</div>
      </div>` : ''}`,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-seed]')) {
          const n = seedPantry();
          toast(`تم استيراد ${n} صنفًا ✓`);
          rerender(); return;
        }
        if (e.target.closest('[data-blank]')) itemSheet(rerender);
        if (e.target.closest('[data-add-category]')) categorySheet(rerender);
      });
    },
  };
}

function categoryOptions(selected) {
  return pantryCategoriesOf().map((c) =>
    `<option value="${esc(c.id)}" ${String(c.id) === String(selected) ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`
  ).join('');
}

function itemSheet(rerender, item = null) {
  const editing = !!item;
  openSheet(`
    <h3>${editing ? 'تعديل المنتج' : 'إضافة منتج للاحتياجات'}</h3>
    <div class="field"><label for="pname">اسم الصنف</label>
      <input class="input" id="pname" placeholder="تونة" autocomplete="off" value="${esc(item?.name || '')}"></div>
    <div class="field"><label for="pcat">القسم</label>
      <select class="input" id="pcat">
        ${categoryOptions(item?.cat || openCat || 'canned')}
      </select></div>
    <div class="hint">يمكنك إنشاء قسم جديد من زر «إضافة قسم» في القائمة.</div>
    <button class="btn block" id="padd">${editing ? 'حفظ التعديل' : 'إضافة المنتج'}</button>
  `, {
    onMount(sheet, close) {
      sheet.querySelector('#padd').onclick = () => {
        const name = sheet.querySelector('#pname').value.trim();
        if (!name) return toast('اكتب اسم الصنف');
        const cat = sheet.querySelector('#pcat').value;
        if (editing) updatePantryItem(item.id, { name, cat });
        else addPantryItem({ name, cat });
        openCat = cat;
        close(); toast(editing ? `تم تعديل "${name}" ✓` : `أُضيف "${name}" ✓`); rerender();
      };
      sheet.querySelector('#pname').focus({ preventScroll: true });
    },
  });
}

function categorySheet(rerender) {
  openSheet(`
    <h3>إضافة قسم للاحتياجات</h3>
    <div class="field"><label for="pcicon">أيقونة القسم</label>
      <input class="input" id="pcicon" value="📦" maxlength="8" inputmode="text"></div>
    <div class="field"><label for="pcname">اسم القسم</label>
      <input class="input" id="pcname" placeholder="مشروبات" maxlength="40" autocomplete="off"></div>
    <button class="btn block" id="pcadd">إضافة القسم</button>
  `, {
    onMount(sheet, close) {
      sheet.querySelector('#pcadd').onclick = () => {
        const name = sheet.querySelector('#pcname').value.trim();
        if (!name) return toast('اكتب اسم القسم');
        const category = addPantryCategory({ name, icon: sheet.querySelector('#pcicon').value });
        if (!category) return toast('اسم القسم موجود بالفعل');
        openCat = category.id;
        close(); toast(`أُضيف قسم "${name}" ✓`); rerender();
      };
      sheet.querySelector('#pcname').focus({ preventScroll: true });
    },
  });
}

