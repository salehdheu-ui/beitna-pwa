/* شاشات المشتريات */

import { esc, relTime, haptic } from '../util.js';
import {
  getState, categoriesOf, addShopping, updateShopping, setShoppingStatus, deleteShopping,
  saveFavoriteList, deleteFavoriteList, applyFavoriteList,
  SHOP_STATUS, SHOP_PRIORITY, CURRENCY,
} from '../store.js';
import { emptyState, toast, confirmDialog, openSheet, chipSelect, bindChips } from '../ui.js';
import { go, back } from '../router.js';

const FILTERS = ['الكل', 'الناقصة', 'قيد الشراء', 'تم الشراء', 'المؤجلة'];
const FILTER_MAP = { 'الناقصة': 'ناقص', 'قيد الشراء': 'قيد الشراء', 'تم الشراء': 'تم الشراء', 'المؤجلة': 'مؤجل' };

let filter = 'الكل';
let query = '';

const catIcon = (name) => categoriesOf('Shopping').find((c) => c.name === name)?.icon || '🛒';

const priorityTone = (p) => (p === 'ضروري' ? 'danger' : p === 'مهم' ? 'warn' : 'gray');
const statusTone = (s) => (s === 'تم الشراء' ? '' : s === 'قيد الشراء' ? 'info' : s === 'مؤجل' ? 'gray' : 'warn');

/* ============================ القائمة ============================ */
export function shoppingScreen() {
  const s = getState();
  let items = s.shopping;
  if (filter !== 'الكل') items = items.filter((i) => i.status === FILTER_MAP[filter]);
  if (query) {
    const q = query.trim();
    items = items.filter((i) => i.name.includes(q) || (i.category || '').includes(q));
  }

  const remaining = s.shopping.filter((i) => i.status !== 'تم الشراء').length;
  const total = s.shopping.length;
  const doneCount = total - remaining;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return {
    title: 'المشتريات',
    subtitle: `${remaining} متبقٍ للشراء`,
    actions: `<button class="icon-btn" data-act="fav" title="القوائم المفضلة">⭐</button>
              <button class="icon-btn" data-act="share" title="مشاركة القائمة">📤</button>`,
    fab: { label: '＋ إضافة عنصر', to: '/shopping/new' },
    html: `
      <div class="card" style="margin-bottom:14px">
        <div class="row between" style="margin-bottom:8px">
          <span class="small strong">التقدّم</span>
          <span class="small muted">${doneCount} من ${total} • ${pct}%</span>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${remaining > 0 ? `<button class="btn soft block mt-s" data-act="session">🛍️ ابدأ جلسة التسوق</button>` : ''}
      </div>

      <div class="search" style="margin-bottom:10px">
        <span>🔍</span>
        <input id="q" placeholder="ابحث باسم العنصر أو التصنيف" value="${esc(query)}">
      </div>

      <div class="filters">
        ${FILTERS.map((f) => `<button class="filter ${f === filter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('')}
      </div>

      <div class="stack mt-s">
        ${items.length ? items.map(itemRow).join('')
          : (s.shopping.length ? emptyState('🔍', 'لا توجد نتائج', 'جرّب كلمة بحث أخرى أو غيّر الفلتر')
                               : emptyState('🛒', 'لا توجد عناصر', 'ابدأ بإضافة أول عنصر للمشتريات'))}
      </div>
    `,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const f = e.target.closest('[data-filter]');
        if (f) { filter = f.dataset.filter; rerender(); return; }

        const check = e.target.closest('[data-check]');
        if (check) {
          const id = Number(check.dataset.check);
          const it = getState().shopping.find((x) => x.id === id);
          setShoppingStatus(id, it.status === 'تم الشراء' ? 'ناقص' : 'تم الشراء');
          haptic(15);
          rerender();
          return;
        }

        const open = e.target.closest('[data-open]');
        if (open) { go(`/shopping/${open.dataset.open}`); return; }

        if (e.target.closest('[data-act="session"]')) { go('/shopping/session'); return; }
      });

      const q = root.querySelector('#q');
      if (q) {
        q.addEventListener('input', () => {
          query = q.value;
          const pos = q.selectionStart;
          rerender();
          const nq = document.querySelector('#q');
          if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
        });
      }
    },
    topActions(e, rerender) {
      if (e === 'fav') return openFavorites(rerender);
      if (e === 'share') return shareList();
    },
  };
}

function itemRow(i) {
  const done = i.status === 'تم الشراء';
  return `
    <div class="item ${done ? 'done' : ''}">
      <button class="check ${done ? 'on' : ''}" data-check="${i.id}" aria-label="تم الشراء">✓</button>
      <div class="grow col" data-open="${i.id}" style="cursor:pointer">
        <div class="title">${esc(i.name)}</div>
        <div class="meta">
          ${i.quantity ? `<span>${esc(i.quantity)}</span>•` : ''}
          <span>${catIcon(i.category)} ${esc(i.category || 'بدون تصنيف')}</span>
          ${i.priority !== 'عادي' ? `<span class="badge ${priorityTone(i.priority)}">${esc(i.priority)}</span>` : ''}
          ${!done ? `<span class="badge ${statusTone(i.status)}">${esc(i.status)}</span>` : ''}
          ${i.priceValue ? `<span>${i.priceValue} ${CURRENCY}</span>` : ''}
        </div>
      </div>
    </div>`;
}

/* ============================ النموذج ============================ */
export function shoppingFormScreen() {
  const cats = categoriesOf('Shopping');
  return {
    title: 'عنصر جديد',
    back: true,
    html: `
      <div class="card">
        <div id="err"></div>
        <div class="field">
          <label for="name">اسم العنصر</label>
          <input class="input" id="name" placeholder="لبن" autocomplete="off">
        </div>
        <div class="field">
          <label for="qty">الكمية</label>
          <input class="input" id="qty" placeholder="2 علبة" autocomplete="off">
        </div>
        <div class="field">
          <label>التصنيف</label>
          ${chipSelect('category', cats.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` })), cats[0]?.name)}
        </div>
        <div class="field">
          <label>الأولوية</label>
          ${chipSelect('priority', SHOP_PRIORITY, 'عادي')}
        </div>
        <div class="field">
          <label for="price">السعر التقريبي (${CURRENCY})</label>
          <input class="input" id="price" type="number" inputmode="decimal" step="0.001" placeholder="0">
        </div>
        <div class="field">
          <label for="note">ملاحظات</label>
          <textarea class="input" id="note" placeholder="اختياري"></textarea>
        </div>
        <button class="btn block" data-save>حفظ العنصر</button>
      </div>`,
    mount(root) {
      const values = bindChips(root);
      root.querySelector('[data-save]').onclick = () => {
        const name = root.querySelector('#name').value.trim();
        if (!name) {
          root.querySelector('#err').innerHTML = `<div class="err">اكتب اسم العنصر</div>`;
          return;
        }
        addShopping({
          name,
          quantity: root.querySelector('#qty').value.trim(),
          category: values.category,
          priority: values.priority,
          price: root.querySelector('#price').value,
          note: root.querySelector('#note').value.trim(),
        });
        toast(values.priority === 'ضروري' ? `🛒 تمت إضافة "${name}" كعنصر ضروري` : `تمت إضافة "${name}"`);
        go('/shopping', { replace: true });
      };
      root.querySelector('#name')?.focus();
    },
  };
}

/* ============================ التفاصيل ============================ */
export function shoppingDetailsScreen({ id }) {
  const item = getState().shopping.find((x) => x.id === Number(id));
  if (!item) {
    return { title: 'تفاصيل العنصر', back: true, html: emptyState('🔍', 'العنصر غير موجود', 'ربما تم تحديثه أو حذفه') };
  }
  return {
    title: 'تفاصيل العنصر',
    back: true,
    html: `
      <div class="card">
        <div class="row" style="gap:14px">
          <div class="avatar" style="width:54px;height:54px;border-radius:16px;background:var(--mint);display:grid;place-items:center;font-size:26px">${catIcon(item.category)}</div>
          <div class="grow">
            <div style="font-size:19px;font-weight:800">${esc(item.name)}</div>
            <div class="muted small">${esc(item.quantity || 'بدون كمية محددة')}</div>
          </div>
        </div>
        <hr class="divider">
        <div class="kv"><span class="k">الحالة</span><span class="v"><span class="badge ${statusTone(item.status)}">${esc(item.status)}</span></span></div>
        <div class="kv"><span class="k">الأولوية</span><span class="v"><span class="badge ${priorityTone(item.priority)}">${esc(item.priority)}</span></span></div>
        <div class="kv"><span class="k">التصنيف</span><span class="v">${esc(item.category || '—')}</span></div>
        <div class="kv"><span class="k">السعر</span><span class="v">${item.priceValue ? `${item.priceValue} ${CURRENCY}` : '—'}</span></div>
        <div class="kv"><span class="k">أضافه</span><span class="v">${esc(item.owner || '—')}</span></div>
        <div class="kv"><span class="k">التاريخ</span><span class="v">${esc(relTime(item.createdAt))}</span></div>
        ${item.note ? `<hr class="divider"><div class="small"><span class="muted">ملاحظة:</span> ${esc(item.note)}</div>` : ''}
      </div>

      <div class="section">
        <div class="section-title">تغيير الحالة</div>
        <div class="chip-select">
          ${SHOP_STATUS.map((st) => `<button class="chip-opt ${st === item.status ? 'active' : ''}" data-status="${esc(st)}">${esc(st)}</button>`).join('')}
        </div>
      </div>

      <div class="mt">
        <button class="btn danger-soft block" data-del>🗑️ حذف العنصر</button>
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-status]');
        if (st) { setShoppingStatus(item.id, st.dataset.status); toast('تم التحديث ✓'); rerender(); return; }
        if (e.target.closest('[data-del]')) {
          const ok = await confirmDialog({
            title: 'حذف العنصر',
            message: `هل أنت متأكد من حذف "${item.name}"؟ لا يمكن استرجاع العنصر بعد الحذف.`,
            confirmText: 'حذف', danger: true,
          });
          if (ok) { deleteShopping(item.id); toast('تم حذف عنصر'); back('/shopping'); }
        }
      });
    },
  };
}

/* ============================ جلسة التسوق ============================ */
export function shoppingSessionScreen() {
  const s = getState();
  const list = s.shopping.filter((i) => i.status !== 'تم الشراء' && i.status !== 'مؤجل');
  const bought = s.shopping.filter((i) => i.status === 'تم الشراء');
  const totalPrice = bought.reduce((a, i) => a + (i.priceValue || 0), 0);

  return {
    title: 'جلسة التسوق',
    subtitle: 'اضغط ✓ بجانب كل عنصر اشتريتَه',
    back: true,
    html: `
      <div class="card" style="margin-bottom:12px">
        <div class="row between">
          <div><div class="tiny muted">متبقٍ للشراء</div><div style="font-size:22px;font-weight:800">${list.length}</div></div>
          <div class="center"><div class="tiny muted">تم شراؤه</div><div style="font-size:22px;font-weight:800;color:var(--emerald)">${bought.length}</div></div>
          <div style="text-align:end"><div class="tiny muted">الإجمالي</div><div style="font-size:22px;font-weight:800">${totalPrice.toFixed(2)} <span class="tiny">${CURRENCY}</span></div></div>
        </div>
      </div>

      ${list.length ? `<div class="stack">${list.map((i) => `
        <div class="item">
          <button class="check" data-buy="${i.id}" aria-label="تم الشراء">✓</button>
          <div class="grow col">
            <div class="title">${esc(i.name)}</div>
            <div class="meta">${esc(i.quantity || '')} ${i.quantity ? '•' : ''} ${catIcon(i.category)} ${esc(i.category || '')}</div>
          </div>
          <button class="btn sm ghost" data-later="${i.id}">تأجيل</button>
        </div>`).join('')}</div>`
      : emptyState('🎉', 'اكتمل التسوّق', 'كل العناصر تم شراؤها — استمتع بوقتك في البيت')}

      <div class="mt">
        <button class="btn ghost block" data-savefav>⭐ حفظ كقائمة مفضلة</button>
        <div style="height:10px"></div>
        <button class="btn block" data-end>إنهاء الجلسة</button>
      </div>`,
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-buy]');
        if (b) { setShoppingStatus(Number(b.dataset.buy), 'تم الشراء'); haptic(18); rerender(); return; }
        const l = e.target.closest('[data-later]');
        if (l) { setShoppingStatus(Number(l.dataset.later), 'مؤجل'); rerender(); return; }
        if (e.target.closest('[data-end]')) { toast('تم إنهاء الجلسة ✓'); go('/shopping', { replace: true }); return; }
        if (e.target.closest('[data-savefav]')) {
          const items = getState().shopping.filter((i) => i.status !== 'تم الشراء');
          if (!items.length) return toast('لا توجد عناصر غير مكتملة للحفظ');
          openSheet(`
            <h3>حفظ قائمة مفضلة</h3>
            <p class="muted small">سيتم حفظ العناصر غير المكتملة فقط لتتمكن من إضافتها بضغطة واحدة لاحقًا.</p>
            <div class="field"><label for="fname">اسم القائمة</label>
              <input class="input" id="fname" placeholder="بقالة الأسبوع"></div>
            <div class="field"><label for="ficon">الأيقونة (Emoji)</label>
              <input class="input" id="ficon" value="⭐" style="text-align:center"></div>
            <button class="btn block" id="fsave">حفظ</button>
          `, {
            onMount(sheet, close) {
              sheet.querySelector('#fsave').onclick = () => {
                const n = sheet.querySelector('#fname').value.trim() || 'قائمة سريعة';
                saveFavoriteList(n, sheet.querySelector('#ficon').value.trim(), items);
                close(); toast('تم الحفظ ✓');
              };
            },
          });
        }
      });
    },
  };
}

/* ============================ القوائم المفضلة ============================ */
function openFavorites(rerender) {
  const lists = getState().favoriteLists;
  openSheet(`
    <h3>القوائم المفضلة</h3>
    <p class="muted small">قوالب محفوظة — أضف كل عناصرها بضغطة واحدة.</p>
    ${lists.length ? `<div class="stack">${lists.map((l) => `
      <div class="item">
        <div class="avatar">${esc(l.icon)}</div>
        <div class="grow col">
          <div class="title">${esc(l.name)}</div>
          <div class="meta">${l.items.length} عناصر جاهزة للإضافة</div>
        </div>
        <button class="btn sm" data-apply="${l.id}">إضافة</button>
        <button class="icon-btn" data-delfav="${l.id}" title="حذف">🗑️</button>
      </div>`).join('')}</div>`
    : `<div class="center muted small" style="padding:26px">لا توجد قوائم محفوظة بعد.<br>احفظ قائمتك من «جلسة التسوق».</div>`}
  `, {
    onMount(sheet, close) {
      sheet.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-apply]');
        if (a) {
          const n = applyFavoriteList(Number(a.dataset.apply));
          close(); toast(`تمت إضافة ${n} عناصر ✓`); rerender(); return;
        }
        const d = e.target.closest('[data-delfav]');
        if (d) {
          const ok = await confirmDialog({
            title: 'حذف القائمة المفضلة',
            message: 'هل تريد حذف هذه القائمة المفضلة؟', confirmText: 'حذف', danger: true,
          });
          if (ok) { deleteFavoriteList(Number(d.dataset.delfav)); close(); toast('تم الحذف'); }
        }
      });
    },
  });
}

/* ============================ المشاركة ============================ */
async function shareList() {
  const items = getState().shopping.filter((i) => i.status !== 'تم الشراء');
  if (!items.length) return toast('لا توجد عناصر للمشاركة');
  const text = 'قائمة المشتريات الحالية\n\n' +
    items.map((i) => `• ${i.name}${i.quantity ? ` — ${i.quantity}` : ''}`).join('\n') +
    '\n\nمن تطبيق بيتنا 🏡';
  try {
    if (navigator.share) await navigator.share({ title: 'قائمة المشتريات', text });
    else { await navigator.clipboard.writeText(text); toast('تم نسخ القائمة ✓'); }
  } catch { /* أُلغيت المشاركة */ }
}

export { updateShopping };
