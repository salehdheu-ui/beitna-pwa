/* أدوات مساعدة عامة */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** تهريب النص قبل إدراجه في HTML */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function nextId(list) {
  return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}

/* ---------- التواريخ ---------- */
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const monthName = (i) => AR_MONTHS[i];
export const dayName = (i) => AR_DAYS[i];

export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
}

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'صباحًا' : 'مساءً';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

export const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const todayStart = () => startOfDay(Date.now());
export const daysBetween = (ms) => Math.round((startOfDay(ms) - todayStart()) / 86400000);

/** «بعد 3 أيام» / «اليوم» / «انتهت» */
export function countdownText(ms) {
  const d = daysBetween(ms);
  if (d < 0) return 'انتهت';
  if (d === 0) return 'اليوم';
  if (d === 1) return 'بعد يوم';
  if (d === 2) return 'بعد يومين';
  if (d <= 10) return `بعد ${d} أيام`;
  return `بعد ${d} يوم`;
}

/** «الآن» / «قبل 5 دقائق» / تاريخ */
export function relTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'الآن';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${days} أيام`;
  return fmtDateShort(ms);
}

export const toInputDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function money(n) {
  const v = Number(n) || 0;
  return v.toFixed(3).replace(/\.?0+$/, '') || '0';
}

export const debounce = (fn, wait = 250) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
};

export function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* لا شيء */ }
}
