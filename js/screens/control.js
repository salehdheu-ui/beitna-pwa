/* لوحة التحكم — لمالك البيت وحده.
   يسمّي أقسامه ويختار أيقوناتها، ويمنح كل فرد ما يراه وما يكتبه بالضبط.
   الواجهة هنا تُظهر وتُخفي؛ والمنع الحقيقي يفرضه الخادم عند كل قراءة وكتابة. */

import { esc } from '../util.js';
import {
  getState, update, SECTION_KEYS, DEFAULT_SECTIONS, sectionsOf, amOwner,
} from '../store.js';
import { toast, confirmDialog, switchEl } from '../ui.js';
import { go } from '../router.js';
import * as cloud from '../cloud.js';

/* مستويات الوصول لكل قسم */
const LEVELS = [
  { value: 'write', label: 'يضيف ويعدّل' },
  { value: 'read', label: 'يشاهد فقط' },
  { value: 'none', label: 'لا يراه' },
];
const DATA_SECTIONS = ['shopping', 'faults', 'occasions'];

/* راية واحدة لكل قدرة حسّاسة */
const FLAGS = [
  ['prices', '💰', 'الأسعار', 'يرى أسعار المشتريات وتكاليف الأعطال ويعدّلها'],
  ['members', '👥', 'بيانات الأفراد', 'يرى هواتف أفراد البيت وبُرُدهم'],
  ['invite', '🔑', 'كود الدعوة', 'يستطيع ضمّ أفراد جدد إلى البيت'],
  ['remove', '🗑️', 'الحذف', 'يحذف عناصر — بلا هذه الراية يضيف ويعدّل فقط'],
];

/* نفس قوالب الخادم — للعرض فقط، والخادم هو الفاصل */
const PRESETS = {
  owner:  { shopping: 'write', faults: 'write', occasions: 'write', prices: true,  members: true,  invite: true,  remove: true },
  member: { shopping: 'write', faults: 'write', occasions: 'write', prices: true,  members: true,  invite: false, remove: true },
  helper: { shopping: 'write', faults: 'write', occasions: 'none',  prices: false, members: false, invite: false, remove: false },
};

const permOf = (m) => (m.perm || (m.isOwner ? 'owner' : 'member'));
const capsOf = (m) => ({ ...(PRESETS[permOf(m)] || PRESETS.member), ...(m.caps || {}) });

/* ما يُحرَّر الآن — يبقى بين الرسمات حتى يُحفظ */
let draftSections = null;
let openMember = null;
let draftCaps = null;

/* ============================ الشاشة ============================ */
export function controlScreen() {
  const s = getState();

  if (!amOwner()) {
    return {
      title: 'لوحة التحكم',
      back: true,
      html: `<div class="card center">
        <div class="empty">
          <div class="ic">🔒</div>
          <h3>لمالك البيت وحده</h3>
          <p class="muted">تسمية الأقسام وصلاحيات الأفراد يضبطها مالك البيت.</p>
        </div>
      </div>`,
    };
  }

  const sections = draftSections || sectionsOf();
  const others = (s.members || []).filter((m) => permOf(m) !== 'owner' && !m.deleted);

  return {
    title: 'لوحة التحكم',
    subtitle: 'أنت مالك البيت — كل شيء هنا',
    back: true,
    html: sectionsCard(sections) + membersCard(others, s.profile) + linksCard(),
    mount(root, rerender) {
      root.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-nav]');
        if (nav) go(nav.dataset.nav);
      });
      mountSections(root, rerender);
      mountMembers(root, rerender, others);
    },
  };
}

/* ---------------- الأقسام ---------------- */
function sectionsCard(sections) {
  return `
  <div class="section">
    <div class="section-title">🎛️ الأقسام</div>
    <div class="card">
      <p class="tiny muted" style="margin:0 0 12px">
        سمِّ أقسام بيتك كما تحب واختر أيقوناتها. التغيير يصل كل أجهزة البيت.
      </p>
      ${SECTION_KEYS.map((key) => {
        const sec = sections[key];
        const def = DEFAULT_SECTIONS[key];
        const changed = sec.label !== def.label || sec.icon !== def.icon;
        return `
        <div class="row" style="gap:8px;align-items:center;margin-bottom:8px">
          <input class="input" data-icon="${esc(key)}" value="${esc(sec.icon)}"
                 maxlength="4" style="width:62px;text-align:center;font-size:19px"
                 aria-label="أيقونة ${esc(def.label)}">
          <input class="input grow" data-label="${esc(key)}" value="${esc(sec.label)}"
                 maxlength="24" aria-label="اسم ${esc(def.label)}">
          ${changed ? `<button class="btn ghost" data-reset="${esc(key)}"
                        title="استعادة ${esc(def.label)}" style="padding:8px 10px">↺</button>` : ''}
        </div>`;
      }).join('')}
      <button class="btn block" data-save-sections>حفظ الأقسام</button>
      <button class="btn ghost block mt-s" data-reset-all>استعادة الأسماء الافتراضية</button>
    </div>
  </div>`;
}

function mountSections(root, rerender) {
  const read = () => {
    const out = {};
    for (const key of SECTION_KEYS) {
      const rawIcon = root.querySelector(`[data-icon="${key}"]`)?.value.trim() || DEFAULT_SECTIONS[key].icon;
      const rawLabel = root.querySelector(`[data-label="${key}"]`)?.value.trim() || DEFAULT_SECTIONS[key].label;
      out[key] = { icon: [...rawIcon].slice(0, 2).join(''), label: rawLabel.slice(0, 24) };
    }
    return out;
  };

  root.querySelectorAll('[data-reset]').forEach((b) => {
    b.addEventListener('click', () => {
      draftSections = { ...read(), [b.dataset.reset]: { ...DEFAULT_SECTIONS[b.dataset.reset] } };
      rerender();
    });
  });

  root.querySelector('[data-reset-all]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'استعادة الأسماء الافتراضية',
      message: 'ستعود كل الأقسام إلى أسمائها وأيقوناتها الأصلية.',
      confirmText: 'استعادة',
    });
    if (!yes) return;
    draftSections = null;
    await persistSections({}, 'عادت الأقسام إلى الافتراضي');
    rerender();
  });

  root.querySelector('[data-save-sections]')?.addEventListener('click', async () => {
    const next = read();
    /* لا نرسل إلا ما يخالف الافتراضي — فيبقى المخزَّن صغيرًا ونظيفًا */
    const diff = {};
    for (const key of SECTION_KEYS) {
      const d = DEFAULT_SECTIONS[key];
      if (next[key].label !== d.label || next[key].icon !== d.icon) diff[key] = next[key];
    }
    draftSections = null;
    await persistSections(diff, 'حُفظت الأقسام');
    rerender();
  });
}

async function persistSections(sections, okMsg) {
  update((st) => { st.ui = { sections }; });
  if (!cloud.hasSession()) { toast(okMsg); return; }
  try {
    await cloud.saveSections(sections);
    toast(okMsg);
  } catch {
    toast('حُفظ على هذا الجهاز — تعذّر الوصول للسحابة');
  }
}

/* ---------------- الأفراد وصلاحياتهم ---------------- */
function membersCard(others, me) {
  return `
  <div class="section">
    <div class="section-title">🛡️ الأفراد وصلاحياتهم</div>
    <div class="list">
      <div class="list-row">
        <span class="ic">👑</span>
        <span class="grow"><span class="t">${esc(me.name || 'أنت')}</span><br>
          <span class="d">مالك البيت — صلاحيات كاملة دائمًا</span></span>
      </div>
      ${others.length ? others.map((m) => {
        const caps = capsOf(m);
        const limits = DATA_SECTIONS.filter((c) => caps[c] !== 'write').length
          + FLAGS.filter(([f]) => caps[f] === false).length;
        return `
        <div class="list-row" data-member="${esc(m.uid)}">
          <span class="ic">${permOf(m) === 'helper' ? '🧹' : '👤'}</span>
          <span class="grow"><span class="t">${esc(m.name || 'فرد')}</span><br>
            <span class="d">${esc(m.role || 'عضو')} — ${limits ? `${limits} قيدًا` : 'بلا قيود'}</span></span>
          <span class="arrow">${openMember === m.uid ? '⌄' : '‹'}</span>
        </div>`;
      }).join('') : ''}
    </div>
    ${others.length ? '' : `<div class="card small muted center">
      لا أحد غيرك في البيت بعد — ادعُ أفراد بيتك من «أفراد البيت».
    </div>`}
    ${openMember ? capsEditor(others.find((m) => m.uid === openMember)) : ''}
  </div>`;
}

function capsEditor(m) {
  if (!m) return '';
  const caps = { ...capsOf(m), ...(draftCaps || {}) };
  const sections = sectionsOf();
  return `
  <div class="card mt">
    <div class="section-title">صلاحيات ${esc(m.name || 'فرد')}</div>

    ${DATA_SECTIONS.map((key) => `
      <div style="margin-bottom:12px">
        <div class="t" style="margin-bottom:6px">${sections[key].icon} ${esc(sections[key].label)}</div>
        <div class="chip-select" data-level="${esc(key)}">
          ${LEVELS.map((l) => `
            <button type="button" class="chip-opt ${caps[key] === l.value ? 'active' : ''}"
                    data-val="${l.value}">${esc(l.label)}</button>`).join('')}
        </div>
      </div>`).join('')}

    <div class="list">
      ${FLAGS.map(([flag, icon, title, desc]) => `
        <div class="list-row" data-flag="${flag}">
          <span class="ic">${icon}</span>
          <span class="grow"><span class="t">${esc(title)}</span><br>
            <span class="d">${esc(desc)}</span></span>
          ${switchEl(caps[flag] !== false, 'flag:' + flag)}
        </div>`).join('')}
    </div>

    <button class="btn block mt" data-save-caps="${esc(m.uid)}">حفظ الصلاحيات</button>
    <button class="btn ghost block mt-s" data-close-caps>إغلاق</button>
    <p class="tiny muted" style="margin:10px 0 0">
      هذه الحدود يفرضها الخادم لا الواجهة — فلا تُتجاوز من جهاز معدَّل.
    </p>
  </div>`;
}

function mountMembers(root, rerender, others) {
  root.querySelectorAll('[data-member]').forEach((b) => {
    b.addEventListener('click', () => {
      const uid = b.dataset.member;
      openMember = openMember === uid ? null : uid;
      draftCaps = null;
      rerender();
    });
  });

  root.querySelectorAll('[data-level]').forEach((set) => {
    set.querySelectorAll('.chip-opt').forEach((opt) => {
      opt.addEventListener('click', () => {
        draftCaps = { ...(draftCaps || {}), [set.dataset.level]: opt.dataset.val };
        rerender();
      });
    });
  });

  root.querySelectorAll('[data-flag]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => {
      const flag = rowEl.dataset.flag;
      const m = others.find((x) => x.uid === openMember);
      const cur = { ...capsOf(m || {}), ...(draftCaps || {}) };
      draftCaps = { ...(draftCaps || {}), [flag]: cur[flag] === false };
      rerender();
    });
  });

  root.querySelector('[data-close-caps]')?.addEventListener('click', () => {
    openMember = null; draftCaps = null; rerender();
  });

  root.querySelector('[data-save-caps]')?.addEventListener('click', async (e) => {
    const uid = e.currentTarget.dataset.saveCaps;
    const m = others.find((x) => x.uid === uid);
    const caps = { ...capsOf(m || {}), ...(draftCaps || {}) };
    try {
      await cloud.setMemberCaps(uid, caps);
      toast('حُفظت الصلاحيات');
      openMember = null; draftCaps = null;
      rerender();
    } catch {
      toast('تعذّر الحفظ — تأكد من الاتصال');
    }
  });
}

/* ---------------- روابط الإدارة القائمة ---------------- */
function linksCard() {
  const row = (icon, title, desc, to) => `
    <div class="list-row" data-nav="${esc(to)}">
      <span class="ic">${icon}</span>
      <span class="grow"><span class="t">${esc(title)}</span><br><span class="d">${esc(desc)}</span></span>
      <span class="arrow">‹</span>
    </div>`;
  return `
  <div class="section">
    <div class="section-title">⚙️ إدارة البيت</div>
    <div class="list">
      ${row('👨‍👩‍👧', 'أفراد البيت', 'الدعوة والأدوار والإخراج', '/household')}
      ${row('🗂️', 'التصنيفات والأماكن', 'أنواع المشتريات والأعطال والتذكيرات', '/categories')}
      ${row('🏘️', 'بيوتي', 'التبديل بين أكثر من بيت', '/houses')}
      ${row('🔔', 'الإشعارات', 'ما يصلك ومتى', '/notifications')}
    </div>
  </div>`;
}
