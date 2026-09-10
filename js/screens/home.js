/* الشاشة الرئيسية */

import { esc, relTime, countdownText } from '../util.js';
import { getState, homeCounts, priorityItems, CURRENCY, profileStats } from '../store.js';
import { emptyState } from '../ui.js';
import { go } from '../router.js';

export function homeScreen() {
  const s = getState();
  const c = homeCounts();
  const pri = priorityItems();
  const st = profileStats();
  const upcoming = s.occasions
    .filter((o) => !o.done && o.dateMillis >= Date.now() - 86400000)
    .sort((a, b) => a.dateMillis - b.dateMillis)
    .slice(0, 3);

  const summary = c.shopping > 0
    ? `عندك ${c.shopping} عنصر ناقص في المشتريات`
    : 'كل العناصر تم شراؤها — استمتع بوقتك في البيت';

  return {
    title: s.household.name || 'بيتنا',
    subtitle: 'إدارة المنزل بذكاء',
    html: `
      <div class="hero">
        <h2>أهلاً، ${esc(s.profile.name || 'بك')} 👋</h2>
        <p>${esc(summary)}</p>
        <div class="chips">
          <span class="chip">🛒 ${c.shopping} مشتريات</span>
          <span class="chip">🔧 ${c.faults} أعطال</span>
          <span class="chip">🎉 ${c.occasions} مناسبات</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">⚡ إجراءات سريعة</div>
        <div class="quick">
          <button class="q" data-nav="/shopping/new"><span class="ic">🛒</span>إضافة مشتريات</button>
          <button class="q" data-nav="/faults/new"><span class="ic">🔧</span>إضافة عطل</button>
          <button class="q" data-nav="/occasions/new"><span class="ic">🎉</span>إضافة مناسبة</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">🎯 الأولوية الآن</div>
        ${pri.length ? `<div class="stack">${pri.map(priCard).join('')}</div>`
          : `<div class="card center muted small" style="padding:22px">لا توجد عناصر عاجلة الآن ✨</div>`}
      </div>

      ${upcoming.length ? `
      <div class="section">
        <div class="section-title">📅 مناسبات قريبة <button class="more" data-nav="/occasions">عرض الكل</button></div>
        <div class="stack">
          ${upcoming.map((o) => `
            <div class="item card tap" data-nav="/occasions/${o.id}">
              <div class="avatar">${esc(iconForType(o.type))}</div>
              <div class="grow col">
                <div class="title">${esc(o.title)}</div>
                <div class="meta">${esc(o.type)} • ${esc(countdownText(o.dateMillis))}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-title">📊 إحصائياتي الفعلية</div>
        <div class="stats">
          <div class="stat" data-nav="/shopping"><div class="n">${st.shoppingDone}</div><div class="l">منها تم شراؤه</div></div>
          <div class="stat" data-nav="/faults"><div class="n">${st.faultsFixed}</div><div class="l">أعطال أُصلحت</div></div>
          <div class="stat"><div class="n">${st.monthlySpent.toFixed(1)}</div><div class="l">إنفاق الشهر ${CURRENCY}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">🕒 آخر النشاطات</div>
        ${s.activities.length ? `
          <div class="list">
            ${s.activities.slice(0, 8).map((a) => `
              <div class="list-row">
                <span class="ic">•</span>
                <span class="grow"><span class="t" style="font-weight:600">${esc(a.text)}</span></span>
                <span class="tiny muted">${esc(relTime(a.time))}</span>
              </div>`).join('')}
          </div>`
        : emptyState('🕒', 'لا توجد نشاطات بعد', 'كل إضافة أو تعديل سيظهر هنا')}
      </div>
    `,
  };
}

function priCard(p) {
  const target = p.kind === 'shopping' ? `/shopping/${p.id}` : p.kind === 'fault' ? `/faults/${p.id}` : `/occasions/${p.id}`;
  return `
    <div class="item tap" data-nav="${target}">
      <div class="avatar">${p.icon}</div>
      <div class="grow col">
        <div class="title">${esc(p.title)}</div>
        <div class="meta"><span class="badge ${p.tone}">${esc(p.tag)}</span></div>
      </div>
      <span class="muted">‹</span>
    </div>`;
}

export function iconForType(type) {
  const map = {
    'عيد ميلاد': '🎂', 'فاتورة': '💡', 'صيانة دورية': '🔧',
    'مناسبة عائلية': '👨‍👩‍👧', 'مناسبة عامة': '🎉', 'اجتماع': '📌',
  };
  return map[type] || '🎉';
}

export function bindHome(root) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-nav]');
    if (el) go(el.dataset.nav);
  });
}
