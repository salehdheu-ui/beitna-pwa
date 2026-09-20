/* عناصر واجهة مشتركة: التنبيهات، النوافذ، الأوراق السفلية */

import { $, esc, haptic, relTime } from './util.js';
import { nameOfUid, myUid } from './store.js';
import { t } from './i18n.js';

/* ============================================================
   سلسلة العهدة — من طلب، من تكفّل، من أنجز.
   الخادم هو من يختم هذه الحقول؛ ما هنا عرضٌ لها فقط.
   ============================================================ */
const DONE_VERB = { shopping: 'اشتراها', faults: 'أصلحه', occasions: 'نفّذه' };
const ASK_VERB = { shopping: 'طلبها', faults: 'سجّله', occasions: 'أضافه' };

const who = (uid) => (uid === myUid() ? 'أنت' : nameOfUid(uid));

/** سطر مختصر لصفوف القوائم: من طلب ومن تكفّل */
export function whoLine(item, col = 'shopping') {
  const bits = [];
  const asked = item.createdBy || item.ownerUid;
  if (asked) bits.push(`${ASK_VERB[col] || 'أضافه'} ${esc(who(asked))}`);
  if (item.doneBy) bits.push(`✅ ${esc(who(item.doneBy))}`);
  else if (item.claimedBy) bits.push(`🙋 ${esc(who(item.claimedBy))} تكفّل`);
  return bits.length ? `<span class="who">${bits.join(' · ')}</span>` : '';
}

/** زرّ التكفّل — أو من أخذها على عاتقه */
export function claimBar(item) {
  if (item.doneBy) {
    return `<div class="claimbar done">✅ أنجزها ${esc(who(item.doneBy))}
      <span class="muted tiny">${item.doneAt ? esc(relTime(item.doneAt)) : ''}</span></div>`;
  }
  if (item.claimedBy) {
    const mine = item.claimedBy === myUid();
    return `<div class="claimbar taken">
      🙋 ${esc(mine ? 'أنت تكفّلت بها' : who(item.claimedBy) + ' تكفّل بها')}
      <span class="muted tiny">${item.claimedAt ? esc(relTime(item.claimedAt)) : ''}</span>
      ${mine ? `<button class="btn sm ghost" data-act="unclaim">تراجع</button>` : ''}
    </div>`;
  }
  return `<button class="btn block soft" data-act="claim">🙋 أتكفّل بها</button>`;
}

const ACT_LINE = {
  create: (col) => ASK_VERB[col] || 'أضافه',
  claim: () => 'تكفّل بها',
  unclaim: () => 'تراجع عن التكفّل',
  done: (col) => DONE_VERB[col] || 'أنجزه',
  reopen: () => 'أعاد فتحها',
  status: (col, to) => `غيّر الحالة إلى ${to || ''}`,
};

/** السجل الكامل: كل فعل ومن فعله ومتى */
export function trailCard(item, col = 'shopping') {
  const trail = Array.isArray(item.trail) ? item.trail : [];
  if (!trail.length) return '';
  return `
  <div class="section">
    <div class="section-title">🧾 من فعل ماذا</div>
    <div class="card">
      ${[...trail].reverse().map((e) => {
        const line = (ACT_LINE[e.act] || (() => e.act))(col, e.to);
        return `<div class="trail-row">
          <span class="trail-who">${esc(who(e.by))}</span>
          <span class="trail-act">${esc(line)}</span>
          <span class="trail-at muted tiny">${esc(relTime(e.at))}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------- التنبيهات ---------- */
export function toast(message, ms = 2200) {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  haptic(10);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------- نافذة تأكيد ---------- */
export function confirmDialog({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#dialogRoot');
    root.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="actions">
          <button class="btn ghost" data-no>${esc(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(confirmText)}</button>
        </div>
      </div>`;
    root.hidden = false;
    const close = (val) => { root.hidden = true; root.innerHTML = ''; resolve(val); };
    root.querySelector('[data-yes]').onclick = () => close(true);
    root.querySelector('[data-no]').onclick = () => close(false);
    root.onclick = (e) => { if (e.target === root) close(false); };
  });
}

export function alertDialog({ title, message, ok = 'حسنًا' }) {
  return new Promise((resolve) => {
    const root = $('#dialogRoot');
    root.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="actions"><button class="btn" data-ok>${esc(ok)}</button></div>
      </div>`;
    root.hidden = false;
    const close = () => { root.hidden = true; root.innerHTML = ''; resolve(); };
    root.querySelector('[data-ok]').onclick = close;
    root.onclick = (e) => { if (e.target === root) close(); };
  });
}

/* ---------- ورقة سفلية ---------- */
let sheetClose = null;

export function openSheet(html, { onMount } = {}) {
  const root = $('#sheetRoot');
  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  const close = () => {
    root.hidden = true; root.innerHTML = '';
    document.body.style.overflow = '';
    sheetClose = null;
  };
  sheetClose = close;
  root.onclick = (e) => { if (e.target === root) close(); };
  onMount?.(root.querySelector('.sheet'), close);
  return close;
}

export function closeSheet() { sheetClose?.(); }

/** خطوات تثبيت التطبيق على iPhone / iPad — لا يوجد زر تثبيت تلقائي في Safari */
export function iosInstallSheet() {
  return openSheet(`
    <h3>${esc(t('install_title'))}</h3>
    <p>${esc(t('install_ios'))}</p>
    <p class="tiny muted">${esc(t('install_hint'))}</p>
    <button class="btn block" data-close>${esc(t('done'))}</button>
  `, {
    onMount(el, close) { el.querySelector('[data-close]').onclick = close; },
  });
}

/* ---------- عناصر جاهزة ---------- */
export const emptyState = (icon, title, desc) => `
  <div class="empty">
    <div class="ic">${icon}</div>
    <div class="t">${esc(title)}</div>
    <div class="d">${esc(desc)}</div>
  </div>`;

export const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;

export function chipSelect(name, options, current) {
  return `<div class="chip-select" data-chipset="${esc(name)}">
    ${options.map((o) => {
      const val = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      return `<button type="button" class="chip-opt ${val === current ? 'active' : ''}" data-val="${esc(val)}">${esc(label)}</button>`;
    }).join('')}
  </div>`;
}

/** يفعّل مجموعات الشرائح داخل عنصر معيّن ويعيد كائن القيم */
export function bindChips(root, values = {}) {
  root.querySelectorAll('[data-chipset]').forEach((set) => {
    const key = set.dataset.chipset;
    if (values[key] === undefined) {
      values[key] = set.querySelector('.chip-opt.active')?.dataset.val ?? '';
    }
    set.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-opt');
      if (!btn) return;
      set.querySelectorAll('.chip-opt').forEach((b) => b.classList.toggle('active', b === btn));
      values[key] = btn.dataset.val;
      haptic(8);
    });
  });
  return values;
}

/** مفتاح تشغيل/إيقاف */
export const switchEl = (on, key) => `<span class="switch ${on ? 'on' : ''}" data-switch="${esc(key)}" role="switch" aria-checked="${on}"></span>`;
