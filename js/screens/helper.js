/* ============================================================
   واجهة العاملة المنزلية
   شاشة واحدة مبسّطة بلغتها: ما ينقص البيت، وإضافة نقص،
   والإبلاغ عن عطل. لا مناسبات ولا أسعار ولا بيانات أفراد.
   ============================================================ */

import { esc } from '../util.js';
import { getState, addShopping, addFault } from '../store.js';
import { toast, openSheet } from '../ui.js';
import { t, LANGS, currentLang, setLang, applyLangToDocument } from '../i18n.js';

const dirAttr = () => (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');

function langSheet(onPick) {
  openSheet(`
    <h3>${esc(t('language'))}</h3>
    <div class="list">
      ${LANGS.map((l) => `
        <button class="list-row" data-lang="${esc(l.code)}">
          <span class="ic">${l.flag}</span>
          <span class="grow"><span class="t" style="direction:${l.dir}">${esc(l.native)}</span></span>
          ${l.code === currentLang() ? '<span class="badge">✓</span>' : '<span class="arrow">‹</span>'}
        </button>`).join('')}
    </div>
  `, {
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-lang]');
        if (!b) return;
        setLang(b.dataset.lang);
        close();
        onPick?.();
      });
    },
  });
}

export { langSheet };

/** الشاشة الوحيدة التي تراها العاملة */
export function helperScreen() {
  const s = getState();
  const missing = s.shopping.filter((i) => i.status !== 'تم الشراء');
  const openFaults = s.faults.filter((f) => f.status !== 'تم الإصلاح');

  return {
    title: t('shopping_title'),
    subtitle: s.household.name || t('app_name'),
    actions: `<button class="icon-btn" data-act="lang" title="${esc(t('language'))}">🌐</button>`,
    html: `
      <div class="section">
        <button class="btn block" data-act="additem">＋ ${esc(t('add_item'))}</button>
        <button class="btn ghost block mt-s" data-act="addfault">🔧 ${esc(t('report_fault'))}</button>
      </div>

      <div class="section">
        <div class="section-title">${esc(t('shopping_title'))} (${missing.length})</div>
        ${missing.length ? `
          <div class="stack">
            ${missing.map((i) => `
              <div class="item">
                <span class="ic">${i.priority === 'ضروري' ? '🔴' : '🛒'}</span>
                <div class="grow col">
                  <div class="title">${esc(i.name)}</div>
                  <div class="meta">${esc(i.quantity || '')} ${
                    i.priority === 'ضروري' ? `<span class="badge warn">${esc(t('urgent'))}</span>` : ''}</div>
                </div>
              </div>`).join('')}
          </div>`
        : `<div class="card small muted center">${esc(t('shopping_empty'))}</div>`}
      </div>

      <div class="section">
        <div class="section-title">${esc(t('faults_title'))} (${openFaults.length})</div>
        ${openFaults.length ? `
          <div class="stack">
            ${openFaults.map((f) => `
              <div class="item"><span class="ic">🔧</span>
                <div class="grow col"><div class="title">${esc(f.title)}</div>
                  <div class="meta">${esc(f.location || '')}</div></div>
              </div>`).join('')}
          </div>`
        : `<div class="card small muted center">${esc(t('faults_empty'))}</div>`}
      </div>

      <p class="tiny muted center mt">${esc(t('helper_role'))} · ${esc(s.profile.name || '')}</p>`,

    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="additem"]')) { addItemSheet(rerender); return; }
        if (e.target.closest('[data-act="addfault"]')) { addFaultSheet(rerender); return; }
      });
    },

    topActions(act, rerender) {
      if (act === 'lang') langSheet(() => { applyLangToDocument(); rerender(); });
    },
  };
}

function addItemSheet(rerender) {
  openSheet(`
    <h3>${esc(t('add_item'))}</h3>
    <div class="field"><label for="hn">${esc(t('item_name'))}</label>
      <input class="input" id="hn" dir="${dirAttr()}"></div>
    <div class="field"><label for="hq">${esc(t('item_qty'))}</label>
      <input class="input" id="hq" dir="${dirAttr()}"></div>
    <label class="row" style="gap:8px;align-items:center;margin-bottom:14px">
      <input type="checkbox" id="hu"> <span>${esc(t('urgent'))}</span></label>
    <button class="btn block" data-save>${esc(t('save'))}</button>
    <button class="btn ghost block mt-s" data-close>${esc(t('cancel'))}</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-save]').onclick = () => {
        const name = el.querySelector('#hn').value.trim();
        if (!name) return toast(t('required'));
        addShopping({
          name,
          quantity: el.querySelector('#hq').value.trim(),
          priority: el.querySelector('#hu').checked ? 'ضروري' : 'عادي',
        });
        close(); toast(t('saved')); rerender();
      };
    },
  });
}

function addFaultSheet(rerender) {
  openSheet(`
    <h3>${esc(t('report_fault'))}</h3>
    <div class="field"><label for="ft">${esc(t('fault_title'))}</label>
      <input class="input" id="ft" dir="${dirAttr()}"></div>
    <div class="field"><label for="fp">${esc(t('fault_place'))}</label>
      <input class="input" id="fp" dir="${dirAttr()}"></div>
    <div class="field"><label for="fn">${esc(t('fault_note'))}</label>
      <textarea class="input" id="fn" rows="3" dir="${dirAttr()}"></textarea></div>
    <button class="btn block" data-save>${esc(t('save'))}</button>
    <button class="btn ghost block mt-s" data-close>${esc(t('cancel'))}</button>
  `, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-save]').onclick = () => {
        const title = el.querySelector('#ft').value.trim();
        if (!title) return toast(t('required'));
        addFault({
          title,
          location: el.querySelector('#fp').value.trim(),
          note: el.querySelector('#fn').value.trim(),
          priority: 'متوسط',
        });
        close(); toast(t('sent')); rerender();
      };
    },
  });
}
