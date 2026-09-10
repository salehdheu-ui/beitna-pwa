/* عناصر واجهة مشتركة: التنبيهات، النوافذ، الأوراق السفلية */

import { $, esc, haptic } from './util.js';

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
